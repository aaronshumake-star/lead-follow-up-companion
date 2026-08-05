import type { VehicleInterest } from '../../domain/models.ts'

/**
 * A one-line description of a unit, skipping whatever is unknown.
 *
 * Screenshot imports often carry only a brand, so this degrades to whatever is
 * on file rather than rendering a row of blanks.
 */
export function describeVehicle(
  vehicle: Pick<VehicleInterest, 'modelYear' | 'make' | 'model' | 'floorplan' | 'stockNumber'>,
): string {
  const parts = [
    vehicle.modelYear === null ? null : String(vehicle.modelYear),
    vehicle.make,
    vehicle.model,
    vehicle.floorplan,
  ].filter((part): part is string => part !== null && part !== '')

  const described = parts.join(' ')
  if (described === '') return vehicle.stockNumber ?? 'Unit not specified'

  return vehicle.stockNumber === null ? described : `${described} (${vehicle.stockNumber})`
}
