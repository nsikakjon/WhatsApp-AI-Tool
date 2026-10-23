// A customer's WhatsApp ID is normally their phone number, digits only
// (2348012345678). Someone who uses a WhatsApp username can hide their number,
// and then Meta only gives us a "business-scoped user ID" (BSUID) such as
// "NG.13491208655302741918". We can still reply to it, but it is not a phone
// number: no wa.me link, nothing to print on an invoice.

export function isPhoneNumber(waId: string): boolean {
  return /^\d+$/.test(waId);
}

/** How to show a customer's WhatsApp ID to a person: "+2348012345678", or a note when the number is hidden. */
export function showWaId(waId: string): string {
  return isPhoneNumber(waId) ? `+${waId}` : "number hidden";
}
