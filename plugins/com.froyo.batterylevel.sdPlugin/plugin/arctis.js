// SteelSeries Arctis 7+ battery reader over raw HID. No SteelSeries GG required.
//
// Protocol (reverse-engineered by the HeadsetControl project):
//   interface 3, usage page 0xffc0, usage 0x01
//   write  [0x00, 0xb0]          -> report id 0, "read device status"
//   read   [0xb0, conn, bat, chg, gameVol, chatVol, ...]
//     conn == 0x01 -> headset is off / out of range
//     bat  == 0..4 -> the dongle only reports 5 buckets, so 0/25/50/75/100
//     chg  == 0x01 -> charging
//
// Usage: node arctis.js [--json|--selftest]

const VENDOR_ID = 0x1038;
const PRODUCTS = {
  0x220e: 'Arctis 7+',
  0x2212: 'Arctis 7+ PS5',
  0x2216: 'Arctis 7+ Xbox',
  0x2236: 'Arctis 7+ Destiny',
  0x2232: 'Arctis Nova 5',
  0x2253: 'Arctis Nova 5X',
};
const NOVA_5_PRODUCTS = new Set([0x2232, 0x2253]);
const USAGE_PAGE = 0xffc0;
const USAGE = 0x01;
const STATUS_REQUEST = [0x00, 0xb0];
const STATUS_ECHO = 0xb0;
const BATTERY_STEPS = 4; // raw 0..4
const READ_TIMEOUT_MS = 1000;

/** Pure decode of an Arctis Nova 5/5X HID 0xb0 status report. */
function decodeNova5Status(buf) {
  if (!buf || buf.length < 5) throw new Error('status report too short');
  // 0x02 = offline in HeadsetControl; guard 0x00/0x01 too (connected = 0x03).
  if (buf[1] === 0x02 || buf[1] === 0x01 || buf[1] === 0x00) {
    return { connected: false, level: null, raw: null, charging: false };
  }
  const raw = buf[3];
  return {
    connected: true,
    raw,
    level: Math.max(0, Math.min(100, raw)),
    charging: buf[4] === 0x01,
  };
}

/** Pure decode of a status report, so it can be tested without hardware. */
function decodeStatus(buf, productId) {
  if (NOVA_5_PRODUCTS.has(productId)) {
    return decodeNova5Status(buf);
  }
  if (!buf || buf.length < 4) throw new Error('status report too short');
  if (buf[1] === 0x01) return { connected: false, level: null, raw: null, charging: false };
  const raw = Math.min(buf[2], BATTERY_STEPS);
  return {
    connected: true,
    raw,
    level: Math.round((raw / BATTERY_STEPS) * 100),
    charging: buf[3] === 0x01,
  };
}

function findDongle(HID) {
  return HID.devices().find(
    (d) =>
      d.vendorId === VENDOR_ID &&
      PRODUCTS[d.productId] &&
      d.usagePage === USAGE_PAGE &&
      d.usage === USAGE
  );
}

/** @returns {{found:boolean, product?:string, connected?:boolean, level?:number, raw?:number, charging?:boolean}} */
function readBattery() {
  const HID = require('node-hid');
  const info = findDongle(HID);
  if (!info) return { found: false };

  const device = new HID.HID(info.path);
  try {
    device.write(STATUS_REQUEST);
    // The dongle also pushes unsolicited reports (chatmix dial). Keep reading
    // until we see the echo of our own request, or give up.
    const deadline = Date.now() + READ_TIMEOUT_MS;
    do {
      const buf = device.readTimeout(Math.max(1, deadline - Date.now()));
      if (buf && buf.length && buf[0] === STATUS_ECHO) {
        return { found: true, product: PRODUCTS[info.productId], ...decodeStatus(buf, info.productId) };
      }
    } while (Date.now() < deadline);
    throw new Error('no status report from dongle within ' + READ_TIMEOUT_MS + 'ms');
  } finally {
    device.close();
  }
}

function selftest() {
  const assert = require('assert');
  // Arctis 7+ status reports (0..4 steps)
  assert.deepStrictEqual(decodeStatus([0xb0, 0x01, 0x00, 0x00]), {
    connected: false, level: null, raw: null, charging: false,
  });
  assert.deepStrictEqual(decodeStatus([0xb0, 0x00, 0x03, 0x00, 0x64, 0x64]), {
    connected: true, raw: 3, level: 75, charging: false,
  });
  assert.deepStrictEqual(decodeStatus([0xb0, 0x00, 0x04, 0x01]), {
    connected: true, raw: 4, level: 100, charging: true,
  });
  assert.deepStrictEqual(decodeStatus([0xb0, 0x00, 0x00, 0x00]), {
    connected: true, raw: 0, level: 0, charging: false,
  });
  // Firmware reporting out of range must clamp, not exceed 100%.
  assert.strictEqual(decodeStatus([0xb0, 0x00, 0x09, 0x00]).level, 100);
  assert.throws(() => decodeStatus([0xb0, 0x00]), /too short/);

  // Arctis Nova 5 / 5X status reports (direct 0..100 percentage at buf[3], charging at buf[4])
  assert.deepStrictEqual(decodeStatus([0xb0, 0x03, 0x02, 0x2f, 0x03], 0x2232), {
    connected: true, raw: 47, level: 47, charging: false,
  });
  assert.deepStrictEqual(decodeStatus([0xb0, 0x03, 0x02, 0x55, 0x01], 0x2253), {
    connected: true, raw: 85, level: 85, charging: true,
  });
  assert.deepStrictEqual(decodeStatus([0xb0, 0x02, 0x02, 0x2f, 0x00], 0x2232), {
    connected: false, level: null, raw: null, charging: false,
  });
  assert.strictEqual(decodeStatus([0xb0, 0x03, 0x02, 120, 0x00], 0x2232).level, 100);
  assert.throws(() => decodeStatus([0xb0, 0x03, 0x02, 0x2f], 0x2232), /too short/);
  console.log('selftest ok');
}

module.exports = { readBattery, decodeStatus, decodeNova5Status, PRODUCTS };

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    selftest();
  } else {
    let result;
    try {
      result = readBattery();
    } catch (e) {
      result = { found: true, connected: false, error: e.message };
    }
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(result));
    } else if (!result.found) {
      console.log('no Arctis 7+ nebo Nova 5 dongle found');
    } else if (!result.connected) {
      console.log(result.error ? 'error: ' + result.error : 'headset off');
    } else {
      console.log(`${result.product}: ${result.level}%${result.charging ? ' (charging)' : ''}`);
    }
    process.exitCode = result.found && result.connected ? 0 : 1;
  }
}