// Xbox controller battery via XInput (xinput1_4.dll, present on Win10/11).
//
// Works for pads on the Xbox Wireless Adapter, over Bluetooth, and wired.
// The Xbox Wireless Adapter's GIP protocol only carries FOUR battery levels —
// see gip_report_battery() in the reverse-engineered xone driver, which maps
// them to Linux's CAPACITY_LEVEL rather than a percentage. XInput exposes the
// same four. There is no real percentage to read; anything finer is invented.
//
// Usage: node xinput.js [--json|--selftest]

const BATTERY_TYPE = { DISCONNECTED: 0, WIRED: 1, ALKALINE: 2, NIMH: 3, UNKNOWN: 0xff };
const BATTERY_STEPS = 3; // XInput levels run 0..3 (empty, low, medium, full)
const ERROR_SUCCESS = 0;
const MAX_SLOTS = 4;

let getBatteryInformation;
function load() {
  if (!getBatteryInformation) {
    const koffi = require('koffi');
    koffi.struct('XINPUT_BATTERY_INFORMATION', { BatteryType: 'uint8', BatteryLevel: 'uint8' });
    getBatteryInformation = koffi
      .load('xinput1_4.dll')
      .func('uint32 XInputGetBatteryInformation(uint32, uint8, _Out_ XINPUT_BATTERY_INFORMATION *)');
  }
  return getBatteryInformation;
}

/**
 * Pure interpretation of an XINPUT_BATTERY_INFORMATION, so it can be tested.
 * `percent` is the level mapped linearly over its range, the same way the
 * headset's 0-4 is mapped — it is a 4-step gauge, not a real percentage.
 */
function describe(info) {
  if (info.BatteryType === BATTERY_TYPE.DISCONNECTED) return null;
  // Wired pads draw from USB and report no meaningful level.
  if (info.BatteryType === BATTERY_TYPE.WIRED) return { wired: true, level: null, percent: null };
  const level = Math.min(info.BatteryLevel, BATTERY_STEPS);
  return { wired: false, level, percent: Math.round((level / BATTERY_STEPS) * 100) };
}

/** @returns {{found:boolean, slot?:number, wired?:boolean, level?:number, percent?:number}} */
function readController() {
  const fn = load();
  for (let slot = 0; slot < MAX_SLOTS; slot++) {
    const info = {};
    if (fn(slot, 0 /* BATTERY_DEVTYPE_GAMEPAD */, info) !== ERROR_SUCCESS) continue;
    const described = describe(info);
    if (described) return { found: true, slot, ...described };
  }
  return { found: false };
}

function selftest() {
  const assert = require('assert');
  assert.strictEqual(describe({ BatteryType: 0, BatteryLevel: 0 }), null);
  assert.deepStrictEqual(describe({ BatteryType: 1, BatteryLevel: 0 }), {
    wired: true, level: null, percent: null,
  });
  assert.deepStrictEqual(describe({ BatteryType: 3, BatteryLevel: 3 }), {
    wired: false, level: 3, percent: 100,
  });
  assert.deepStrictEqual(describe({ BatteryType: 3, BatteryLevel: 2 }), {
    wired: false, level: 2, percent: 67,
  });
  assert.deepStrictEqual(describe({ BatteryType: 2, BatteryLevel: 0 }), {
    wired: false, level: 0, percent: 0,
  });
  // A level outside the documented 0-3 must clamp, not exceed 100%.
  assert.strictEqual(describe({ BatteryType: 3, BatteryLevel: 9 }).percent, 100);
  console.log('selftest ok');
}

module.exports = { readController, describe };

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    selftest();
  } else {
    const result = readController();
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(result));
    } else if (!result.found) {
      console.log('no XInput controller connected');
    } else {
      console.log(`controller ${result.slot}: ${result.wired ? 'wired (usb)' : result.percent + '%'}`);
    }
    process.exitCode = result.found ? 0 : 1;
  }
}
