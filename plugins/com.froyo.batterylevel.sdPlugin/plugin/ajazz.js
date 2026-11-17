// Ajazz wireless mouse battery over USB HID (2.4G dongle Feature Report 0).
//
// Sends FEA_CMD_GET_BATTERY (0x83 with BIT7 checksum 0x7c) on the dongle's vendor
// collection (usagePage 0xffff, usage 0x02) and reads back the 65-byte
// DangleCommonStatus feature report:
//   buf[0] = 0x00 (Report ID 0)
//   buf[1] = keyboard battery, buf[2] = keyboard online
//   buf[3] = mouse battery (0..100), buf[4] = mouse online (1 = online, 0 = sleep/offline)
//
// Usage: node ajazz.js [--json|--selftest]

const VENDOR_AJAZZ = 0x3151;
const USAGE_PAGE = 0xffff;
const USAGE = 0x02;
const WIRED_PIDS = new Set([0x4026]);
const PRODUCTS = {
  0x402d: 'AJ179 PRO',
  0x5008: 'AJ179 PRO/APEX',
  0x5031: 'AJ179',
  0x4026: 'AJ179 PRO (USB)',
};
const FEATURE_LEN = 65;
const CMD_GET_BATTERY = 0x83;
const CMD_CHECKSUM = 0xff - CMD_GET_BATTERY; // 0x7c (BIT7)
const WAIT_ARRAY = new Int32Array(new SharedArrayBuffer(4));

/** Build the 65-byte HID Feature Report query for FEA_CMD_GET_BATTERY. */
function buildBatteryRequest() {
  const req = new Array(FEATURE_LEN).fill(0);
  req[0] = 0x00;
  req[1] = CMD_GET_BATTERY;
  req[7] = CMD_CHECKSUM;
  req[8] = CMD_CHECKSUM;
  return req;
}

/** Pure decode of a 65-byte (with Report ID) or 64-byte status buffer. */
function decodeStatus(buf, charging = false) {
  if (!buf || buf.length < 5) throw new Error('status report too short');
  const offset = buf.length === 64 ? 0 : 1;
  const mouseBattery = buf[offset + 2];
  const mouseOnline = buf[offset + 3] === 0x01;
  if (mouseBattery > 100) throw new Error('battery out of range: ' + mouseBattery);
  if (!mouseOnline || mouseBattery === 0) {
    return { connected: false, percent: null, charging: Boolean(charging) };
  }
  return {
    connected: true,
    percent: mouseBattery,
    charging: Boolean(charging),
  };
}

function readFromCollection(HID, info, isWired) {
  const dev = new HID.HID(info.path);
  try {
    try {
      dev.sendFeatureReport(buildBatteryRequest());
    } catch {
      /* some interfaces populate DangleCommonStatus passively on getFeatureReport */
    }
    Atomics.wait(WAIT_ARRAY, 0, 0, 15);
    const buf = dev.getFeatureReport(0, FEATURE_LEN);
    const status = decodeStatus(buf, isWired);
    if (!status.connected) return null;
    return {
      found: true,
      product: PRODUCTS[info.productId] || info.product || 'Ajazz Mouse',
      ...status,
    };
  } finally {
    dev.close();
  }
}

/** @returns {{found:boolean, product?:string, connected?:boolean, percent?:number|null, charging?:boolean}} */
function readBattery() {
  const HID = require('node-hid');
  const all = HID.devices().filter((d) => d.vendorId === VENDOR_AJAZZ);
  const isWired = all.some((d) => WIRED_PIDS.has(d.productId));
  const collections = all.filter(
    (d) => d.usagePage === USAGE_PAGE && d.usage === USAGE && !WIRED_PIDS.has(d.productId)
  );
  for (const info of collections) {
    let result = null;
    try {
      result = readFromCollection(HID, info, isWired);
    } catch {
      continue;
    }
    if (result) return result;
  }
  if (isWired) {
    return {
      found: true,
      product: 'AJ179 PRO (USB)',
      connected: true,
      percent: 100,
      charging: true,
    };
  }
  return { found: false };
}

function selftest() {
  const assert = require('assert');
  assert.deepStrictEqual(decodeStatus([0x00, 0x00, 0x00, 57, 0x01, 0x00, 0x01, 0x02]), {
    connected: true, percent: 57, charging: false,
  });
  assert.deepStrictEqual(decodeStatus([0x00, 0x00, 0x00, 85, 0x01], true), {
    connected: true, percent: 85, charging: true,
  });
  assert.deepStrictEqual(decodeStatus([0x00, 0x00, 0x00, 0, 0x00]), {
    connected: false, percent: null, charging: false,
  });
  assert.deepStrictEqual(decodeStatus([0x00, 0x00, 0x00, 57, 0x00]), {
    connected: false, percent: null, charging: false,
  });
  assert.throws(() => decodeStatus([0x00, 0x00, 0x00, 170, 0x01]), /out of range/);
  assert.throws(() => decodeStatus([0x00, 0x00]), /too short/);
  console.log('selftest ok');
}

module.exports = { readBattery, decodeStatus, PRODUCTS };

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    selftest();
  } else {
    let result;
    try {
      result = readBattery();
    } catch (e) {
      result = { found: false, error: e.message };
    }
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(result));
    } else if (!result.found) {
      console.log(result.error ? 'error: ' + result.error : 'no Ajazz mouse answering');
    } else {
      console.log(
        `${result.product}: ${result.percent}%${result.charging ? ' (charging)' : ''}`
      );
    }
    process.exitCode = result.found ? 0 : 1;
  }
}
