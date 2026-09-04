import { CARNAVAL_2027_RULES } from '../rules.js';

export type Specialty = (typeof CARNAVAL_2027_RULES.specialtiesPerNight)[number];

export const SPECIALTIES: readonly Specialty[] = CARNAVAL_2027_RULES.specialtiesPerNight;