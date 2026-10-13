import { describe, it, expect, vi } from 'vitest'
import AirPurifierAccessory from '../src/accessories/AirPurifier.accessory'
import {
  createMockLogger,
  createMockTuyaDevice,
  createMockPlatformAccessory,
  createMockCharacteristic,
  createMockService,
  createMockCategories,
} from './helpers'

function createAirPurifier(contextOverrides = {}) {
  const device = createMockTuyaDevice({
    name: 'Test Purifier',
    type: 'airpurifier',
    version: '3.4',
    ...contextOverrides,
  } as any)

  const accessory = createMockPlatformAccessory(contextOverrides)
  const log = createMockLogger()
  const Characteristic = createMockCharacteristic()
  const Service = createMockService()

  const platform = {
    log,
    api: {
      hap: {
        Characteristic,
        Service,
        Categories: createMockCategories(),
      },
    },
    registerPlatformAccessories: vi.fn(),
  }

  const purifier = new AirPurifierAccessory(platform, accessory, device, false)

  return { purifier, device, accessory, platform, log, Characteristic, Service }
}

describe('AirPurifierAccessory', () => {
  describe('getCategory', () => {
    it('returns AIR_PURIFIER category', () => {
      expect(AirPurifierAccessory.getCategory(createMockCategories())).toBe(19)
    })
  })

  describe('rotation speed mapping', () => {
    it('builds a mapping even when noRotationSpeed is not set (regression)', () => {
      const { purifier } = createAirPurifier()

      // Previously `_rotationStops` stayed undefined here, so the first lookup
      // threw "Cannot convert undefined or null to object".
      expect(purifier.convertRotationSpeedFromHomeKitToTuya(100)).toBe(100)
      expect(purifier.convertRotationSpeedFromTuyaToHomeKit(100)).toBe(100)
    })

    it('registers characteristics without throwing when nothing is configured', () => {
      const { purifier } = createAirPurifier()

      purifier._registerPlatformAccessory()

      expect(() => purifier._registerCharacteristics({ '1': true, '4': 40 })).not.toThrow()
    })

    it('maps an explicit string speed list in the device type', () => {
      const { purifier } = createAirPurifier({
        speedValues: ['1', '2', '3', '4', '5', '6', '7', '8'],
      })

      expect(purifier.convertRotationSpeedFromHomeKitToTuya(100)).toBe('8')
      expect(purifier.convertRotationSpeedFromHomeKitToTuya(0)).toBe('1')
      expect(typeof purifier.convertRotationSpeedFromHomeKitToTuya(50)).toBe('string')
    })

    it('maps device speed values back into the matching HomeKit band', () => {
      const { purifier } = createAirPurifier({
        speedValues: ['1', '2', '3', '4', '5', '6', '7', '8'],
      })

      const low = purifier.convertRotationSpeedFromTuyaToHomeKit('1')
      const high = purifier.convertRotationSpeedFromTuyaToHomeKit('8')

      expect(low).toBeGreaterThan(0)
      expect(low).toBeLessThan(high)
      expect(high).toBeLessThanOrEqual(100)
    })

    it('preserves numeric speed values', () => {
      const { purifier } = createAirPurifier({ speedValues: [1, 2, 3] })

      expect(purifier.convertRotationSpeedFromHomeKitToTuya(100)).toBe(3)
      expect(typeof purifier.convertRotationSpeedFromHomeKitToTuya(50)).toBe('number')
    })

    it('matches a string datapoint against a numeric mapping', () => {
      const { purifier } = createAirPurifier({ speedValues: [1, 2, 3] })

      // Some devices report the same enum as a string even when the mapping uses numbers.
      const matched = purifier.getKeyByValue(purifier._rotationStops as Record<string, any>, '2')

      expect(matched).toBeDefined()
    })

    it('ignores blank entries in speedValues', () => {
      const { purifier } = createAirPurifier({ speedValues: ['1', '', null, '2'] })

      expect(purifier.convertRotationSpeedFromHomeKitToTuya(100)).toBe('2')
    })
  })

  describe('auxiliary switches (anion / uv)', () => {
    it('adds Anion and UV switch services when configured', () => {
      const { purifier, accessory, Service } = createAirPurifier({ dpAnion: '6', dpUv: '9' })

      purifier._registerPlatformAccessory()

      expect(accessory.getServiceById(Service.Switch, 'anion')).toBeDefined()
      expect(accessory.getServiceById(Service.Switch, 'uv')).toBeDefined()
    })

    it('does not add them when not configured', () => {
      const { purifier, accessory, Service } = createAirPurifier()

      purifier._registerPlatformAccessory()

      expect(accessory.getServiceById(Service.Switch, 'anion')).toBeUndefined()
      expect(accessory.getServiceById(Service.Switch, 'uv')).toBeUndefined()
    })

    it('wires the On characteristic to the configured datapoint', () => {
      const { purifier, accessory, Service, Characteristic } = createAirPurifier({ dpAnion: '6', dpUv: '9' })

      purifier._registerPlatformAccessory()
      purifier._registerCharacteristics({ '1': true, '4': '1', '6': true, '9': false })

      expect(accessory.getServiceById(Service.Switch, 'anion').getCharacteristic(Characteristic.On).value).toBe(true)
      expect(accessory.getServiceById(Service.Switch, 'uv').getCharacteristic(Characteristic.On).value).toBe(false)
    })

    it('updates the switch when its datapoint changes', () => {
      const { purifier, device, accessory, Service, Characteristic } = createAirPurifier({ dpAnion: '6' })

      purifier._registerPlatformAccessory()
      purifier._registerCharacteristics({ '1': true, '6': true })

      const char = accessory.getServiceById(Service.Switch, 'anion').getCharacteristic(Characteristic.On)
      const updateSpy = vi.spyOn(char, 'updateValue')

      device.state = { '1': true, '6': false }
      device.emit('change', { '6': false })

      expect(updateSpy).toHaveBeenCalledWith(false)
    })

    it('adds the switches for a restored (cached) accessory', () => {
      const { purifier, accessory, Service } = createAirPurifier({ dpAnion: '6', dpUv: '9' })

      // A cached accessory is constructed with isNew === false, so
      // _registerPlatformAccessory never runs for it — but it already has its
      // primary service persisted.
      accessory.addService(Service.AirPurifier, 'Test Purifier')
      expect(accessory.getServiceById(Service.Switch, 'anion')).toBeUndefined()

      purifier._registerCharacteristics({ '1': true, '6': true, '9': true })

      expect(accessory.getServiceById(Service.Switch, 'anion')).toBeDefined()
      expect(accessory.getServiceById(Service.Switch, 'uv')).toBeDefined()
    })

    it('removes the switch when its datapoint is no longer configured', () => {
      const { purifier, accessory, Service } = createAirPurifier({ dpAnion: '6' })

      purifier._registerPlatformAccessory()
      expect(accessory.getServiceById(Service.Switch, 'anion')).toBeDefined()

      delete purifier.device.context.dpAnion
      purifier._registerPlatformAccessory()

      expect(accessory.getServiceById(Service.Switch, 'anion')).toBeUndefined()
    })
  })

  describe('sleep switch', () => {
    it('adds a Sleep switch when enabled', () => {
      const { purifier, accessory, Service } = createAirPurifier({ sleepSwitch: true })

      purifier._registerPlatformAccessory()

      expect(accessory.getServiceById(Service.Switch, 'sleep')).toBeDefined()
    })

    it('does not add it when disabled', () => {
      const { purifier, accessory, Service } = createAirPurifier()

      purifier._registerPlatformAccessory()

      expect(accessory.getServiceById(Service.Switch, 'sleep')).toBeUndefined()
    })

    it('is on when the device is in sleep mode', () => {
      const { purifier, accessory, Service, Characteristic } = createAirPurifier({ sleepSwitch: true })

      purifier._registerPlatformAccessory()
      purifier._registerCharacteristics({ '1': true, '3': 'Sleep', '4': '1' })

      expect(accessory.getServiceById(Service.Switch, 'sleep').getCharacteristic(Characteristic.On).value).toBe(true)
    })

    it('is off when the mode is not sleep', () => {
      const { purifier, accessory, Service, Characteristic } = createAirPurifier({ sleepSwitch: true })

      purifier._registerPlatformAccessory()
      purifier._registerCharacteristics({ '1': true, '3': 'Auto', '4': '1' })

      expect(accessory.getServiceById(Service.Switch, 'sleep').getCharacteristic(Characteristic.On).value).toBe(false)
    })

    it('switching on writes the sleep mode value', () => {
      const { purifier, device } = createAirPurifier({ sleepSwitch: true })

      device.connected = true
      purifier._registerPlatformAccessory()
      purifier._registerCharacteristics({ '1': true, '3': 'Manual', '4': '1' })

      purifier.setSleep(true, vi.fn())

      expect(device.update).toHaveBeenCalledWith({ '3': 'Sleep' })
    })

    it('switching off returns to manual', () => {
      const { purifier, device } = createAirPurifier({ sleepSwitch: true })

      device.connected = true
      purifier._registerPlatformAccessory()
      purifier._registerCharacteristics({ '1': true, '3': 'Sleep', '4': '1' })

      purifier.setSleep(false, vi.fn())

      expect(device.update).toHaveBeenCalledWith({ '3': 'Manual' })
    })

    it('tracks sleep changes reported by the device', () => {
      const { purifier, device, accessory, Service, Characteristic } = createAirPurifier({ sleepSwitch: true })

      purifier._registerPlatformAccessory()
      purifier._registerCharacteristics({ '1': true, '3': 'Manual', '4': '1' })

      const char = accessory.getServiceById(Service.Switch, 'sleep').getCharacteristic(Characteristic.On)
      const updateSpy = vi.spyOn(char, 'updateValue')

      device.state = { '1': true, '3': 'Sleep', '4': '1' }
      device.emit('change', { '3': 'Sleep' })

      expect(updateSpy).toHaveBeenCalledWith(true)
    })
  })
})
