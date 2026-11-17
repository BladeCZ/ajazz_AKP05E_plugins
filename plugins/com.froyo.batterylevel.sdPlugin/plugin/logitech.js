// Logitech wireless battery over HID++ 2.0, feature 0x1004 UNIFIED_BATTERY.
//
// Unlike the Arctis (5 steps) and Xbox GIP (4 steps), this one carries a real
// state-of-charge byte, 0-100.
//
// Requests go out as long reports (id 0x11, 20 bytes) on the receiver's vendor
// collection (usage page 0xff00, usage 2). G HUB polls the same device and
// steals replies, so every exchange is retried; a reply is only accepted when
// the device index, feature index AND function|swId all match, otherwise a
// stale answer to an earlier request gets mistaken for this one's.
//
// Usage: node logitech.js [--json|--selftest]

const VENDOR_LOGITECH = 0x046d;
const LONG_REPORT = 0x11;
const LONG_SIZE = 20;
const SW_ID = 0x0d;
const ROOT_FEATURE = 0x00;
const UNIFIED_BATTERY = 0x1004;
const ERROR_FEATURE = 0xff;

const DEVICE_INDEXES = [1, 2, 3]; // receivers pair few devices; keep the scan short
const RETRIES = 6;
const REPLY_MS = 200;

// chargingStatus from the 0x1004 spec
const CHARGE = { DISCHARGING: 0, CHARGING: 1, SLOW: 2, COMPLETE: 3 };

/** Pure decode of a get_status reply, so it can be tested without hardware. */
function decodeStatus(reply) {
  if (!reply || reply.length < 7) throw new Error('status reply too short');
  const percent = reply[4];
  if (percent > 100) throw new Error('state of charge out of range: ' + percent);
  const status = reply[6];
  return {
    percent,
    level: reply[5],
    charging: status === CHARGE.CHARGING || status === CHARGE.SLOW || status === CHARGE.COMPLETE,
  };
}

function exchange(dev, deviceIndex, featureIndex, funcId, params = []) {
  const head = (funcId << 4) | SW_ID;
  const buf = [LONG_REPORT, deviceIndex, featureIndex, head, ...params];
  while (buf.length < LONG_SIZE) buf.push(0);

  for (let attempt = 0; attempt < RETRIES; attempt++) {
    dev.write(buf);
    const deadline = Date.now() + REPLY_MS;
    while (Date.now() < deadline) {
      const r = dev.readTimeout(Math.max(1, deadline - Date.now()));
      if (!r || r.length < 7) continue;
      if (r[1] !== deviceIndex) continue;
      if (r[2] === ERROR_FEATURE) return null;
      if (r[2] === featureIndex && r[3] === head) return r;
    }
  }
  return null;
}

function readFromCollection(HID, info) {
  const dev = new HID.HID(info.path);
  try {
    for (const deviceIndex of DEVICE_INDEXES) {
      const root = exchange(dev, deviceIndex, ROOT_FEATURE, 0x00, [
        UNIFIED_BATTERY >> 8,
        UNIFIED_BATTERY & 0xff,
        0,
      ]);
      const featureIndex = root && root[4];
      if (!featureIndex) continue; // 0 means the device does not have this feature

      const status = exchange(dev, deviceIndex, featureIndex, 0x01); // get_status
      if (status) return { found: true, deviceIndex, ...decodeStatus(status) };
    }
  } finally {
    dev.close();
  }
  return null;
}

/** @returns {{found:boolean, deviceIndex?:number, percent?:number, level?:number, charging?:boolean}} */
function readBattery() {
  const HID = require('node-hid');
  // Enumerated fresh every call, so a different USB port or a replug just works.
  const collections = HID.devices().filter(
    (d) => d.vendorId === VENDOR_LOGITECH && d.usagePage === 0xff00 && d.usage === 2
  );
  for (const info of collections) {
    let result = null;
    try {
      result = readFromCollection(HID, info);
    } catch {
      continue; // busy or vanished mid-scan; try the next collection
    }
    if (result) return result;
  }
  return { found: false };
}

function selftest() {
  const assert = require('assert');
  // stateOfCharge 0x5b, level bitfield 8, discharging — a real capture.
  assert.deepStrictEqual(decodeStatus([0x11, 0x01, 0x06, 0x1d, 0x5b, 0x08, 0x00]), {
    percent: 91, level: 8, charging: false,
  });
  assert.strictEqual(decodeStatus([0x11, 1, 6, 0x1d, 100, 8, CHARGE.CHARGING]).charging, true);
  assert.strictEqual(decodeStatus([0x11, 1, 6, 0x1d, 100, 8, CHARGE.COMPLETE]).charging, true);
  assert.strictEqual(decodeStatus([0x11, 1, 6, 0x1d, 0, 1, 0]).percent, 0);
  assert.throws(() => decodeStatus([0x11, 1, 6]), /too short/);
  // A nonsense byte must be rejected, not rendered as "170%".
  assert.throws(() => decodeStatus([0x11, 1, 6, 0x1d, 170, 8, 0]), /out of range/);
  console.log('selftest ok');
}

module.exports = { readBattery, decodeStatus };

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
      console.log(result.error ? 'error: ' + result.error : 'no Logitech device answering');
    } else {
      console.log(
        `Logitech device ${result.deviceIndex}: ${result.percent}%${result.charging ? ' (charging)' : ''}`
      );
    }
    process.exitCode = result.found ? 0 : 1;
  }
}
