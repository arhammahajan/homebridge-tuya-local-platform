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
})
