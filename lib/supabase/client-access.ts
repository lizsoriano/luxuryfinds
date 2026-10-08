// Internal Auth identifier for clients without an email. It is never shown as
// contact information and stays stable if the client changes her phone.
export function clientAccessEmail(id: string) {
  return `client-${id}@access.luxuryfinds.invalid`;
}
