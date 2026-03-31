// web-apps/mmr-webapp/lib/date.ts

export function formatLocaleDate(
  dateString: string | null | undefined,
  locale: string = 'en-US',
  timeZone: string = 'America/New_York'
): string {
  if (!dateString) {
    return '';
  }
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return dateString; // Return original string if invalid
    }
    // toLocaleDateString is good for just date, which is what was there before
    return date.toLocaleDateString(locale, { timeZone });
  } catch (e) {
    console.error('Failed to format date', dateString, e);
    return dateString; // Return original string on error
  }
}
