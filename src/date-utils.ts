// ── date-utils.ts ─────────────────────────────────────────────────────────
// Date conversion utilities for Gregorian and Jalali (Persian) calendars
// ─────────────────────────────────────────────────────────────────────────────

import { CalendarSystem } from './types';

/**
 * Convert Gregorian date to Jalali (Persian) date
 */
export function gregorianToJalali(gYear: number, gMonth: number, gDay: number): [number, number, number] {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  
  let jy = (gYear <= 1600) ? 0 : 979;
  gYear -= (gYear <= 1600) ? 621 : 1600;
  
  let gy2 = (gMonth > 2) ? (gYear + 1) : gYear;
  let days = (365 * gYear) + (Math.floor((gy2 + 3) / 4)) - (Math.floor((gy2 + 99) / 100)) + 
             (Math.floor((gy2 + 399) / 400)) - 80 + gDay + g_d_m[gMonth - 1];
  
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  
  const jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  
  return [jy, jm, jd];
}

/**
 * Convert Jalali (Persian) date to Gregorian date
 */
export function jalaliToGregorian(jYear: number, jMonth: number, jDay: number): [number, number, number] {
  let gy = (jYear <= 979) ? 621 : 1600;
  jYear -= (jYear <= 979) ? 0 : 979;
  
  let days = (365 * jYear) + ((Math.floor(jYear / 33)) * 8) + (Math.floor(((jYear % 33) + 3) / 4)) + 
             78 + jDay + ((jMonth < 7) ? (jMonth - 1) * 31 : ((jMonth - 7) * 30) + 186);
  
  gy += 400 * Math.floor(days / 146097);
  days %= 146097;
  
  let leap = true;
  if (days >= 36525) {
    days--;
    gy += 100 * Math.floor(days / 36524);
    days %= 36524;
    if (days >= 365) days++;
    else leap = false;
  }
  
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  
  if (days >= 366) {
    leap = false;
    days--;
    gy += Math.floor(days / 365);
    days %= 365;
  }
  
  const sal_a = [0, 31, ((leap ? 29 : 28)), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (gm = 0; gm < 13 && days >= sal_a[gm]; gm++) {
    days -= sal_a[gm];
  }
  const gd = days + 1;
  
  return [gy, gm, gd];
}

/**
 * Format a date string according to the calendar system
 */
export function formatDate(dateStr: string, calendarSystem: CalendarSystem, language: 'en' | 'fa'): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  
  if (calendarSystem === 'jalali') {
    const [jYear, jMonth, jDay] = gregorianToJalali(year, month, day);
    
    if (language === 'fa') {
      // Persian month names
      const persianMonths = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 
                             'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
      return `${jDay} ${persianMonths[jMonth - 1]} ${jYear}`;
    } else {
      // English transliteration
      const persianMonthsEn = ['Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar',
                               'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand'];
      return `${jDay} ${persianMonthsEn[jMonth - 1]} ${jYear}`;
    }
  } else {
    // Gregorian calendar
    if (language === 'fa') {
      const gregorianMonthsFa = ['ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن',
                                 'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر'];
      return `${day} ${gregorianMonthsFa[month - 1]} ${year}`;
    } else {
      const gregorianMonthsEn = ['January', 'February', 'March', 'April', 'May', 'June',
                                 'July', 'August', 'September', 'October', 'November', 'December'];
      return `${day} ${gregorianMonthsEn[month - 1]} ${year}`;
    }
  }
}

/**
 * Get today's date in the specified calendar system as YYYY-MM-DD
 */
export function getTodayInCalendar(calendarSystem: CalendarSystem): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  
  // Always return in Gregorian format for internal storage
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
