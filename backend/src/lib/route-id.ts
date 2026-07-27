/** Express 5: req.params.id string | string[] olabilir */
export type RouteId = string;

export function routeId(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
