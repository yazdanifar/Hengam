declare module 'jalaali-js' {
  export function toJalaali(gy: number, gm: number, gd: number): { jy: number; jm: number; jd: number }
  export function toGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number }
  export function jalaaliMonthLength(jy: number, jm: number): number
  export function isLeapJalaaliYear(jy: number): boolean
  const _default: {
    toJalaali: typeof toJalaali
    toGregorian: typeof toGregorian
    jalaaliMonthLength: typeof jalaaliMonthLength
    isLeapJalaaliYear: typeof isLeapJalaaliYear
  }
  export default _default
}
