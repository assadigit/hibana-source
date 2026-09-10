// UUIDs — rule 2. Client-generated ones arrive over the wire and are accepted as canonical
// (Canvas elements, Spark quick-add); anything created server-side uses this.
export function uuid(): string {
  return crypto.randomUUID()
}