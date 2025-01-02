/** OpenAPI 3.1 description of the JSON API, served at /api/openapi.json. */
export function openApiSpec(origin: string) {
  const error = { $ref: "#/components/schemas/Error" };
  const slug = { name: "slug", in: "path", required: true, schema: { type: "string" } };
  const notFound = { description: "No such link, or the token doesn't match it", content: { "application/json": { schema: error } } };

  return {
    openapi: "3.1.0",
    info: {
      title: "snip API",
      version: "1.0.0",
      description: "Create short links and read their stats. Creating needs no account; managing a link needs the token returned when it was created.",
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: { manageToken: { type: "http", scheme: "bearer", description: "The manageToken returned when the link was created" } },
      schemas: {
        Error: { type: "object", required: ["error"], properties: { error: { type: "string" }, message: { type: "string" } } },
        CreatedLink: {
          type: "object",
          properties: {
            slug: { type: "string" },
            shortUrl: { type: "string", format: "uri" },
            targetUrl: { type: "string", format: "uri" },
            expiresAt: { type: ["string", "null"], format: "date-time" },
            manageToken: { type: "string", description: "Shown once. Keep it to manage the link." },
            statsUrl: { type: "string", format: "uri" },
            qrUrl: { type: "string", format: "uri" },
          },
        },
        Count: { type: "object", properties: { label: { type: "string" }, clicks: { type: "integer" } } },
        Stats: {
          type: "object",
          properties: {
            slug: { type: "string" },
            targetUrl: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            expiresAt: { type: ["string", "null"], format: "date-time" },
            disabled: { type: "boolean" },
            totalClicks: { type: "integer" },
            lastClickAt: { type: ["string", "null"], format: "date-time" },
            days: { type: "array", items: { type: "object", properties: { date: { type: "string", format: "date" }, clicks: { type: "integer" } } } },
            referrers: { type: "array", items: { $ref: "#/components/schemas/Count" } },
            countries: { type: "array", items: { $ref: "#/components/schemas/Count" } },
            devices: { type: "array", items: { $ref: "#/components/schemas/Count" } },
            browsers: { type: "array", items: { $ref: "#/components/schemas/Count" } },
          },
        },
      },
    },
    paths: {
      "/api/links": {
        post: {
          operationId: "createLink",
          summary: "Create a short link",
          security: [], // public on purpose: no account needed
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["url"],
                  properties: {
                    url: { type: "string", description: "http(s) URL; a bare domain gets https://" },
                    slug: { type: "string", pattern: "^[A-Za-z0-9_-]{3,40}$", description: "Custom name (optional)" },
                    expiresAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/CreatedLink" } } } },
            400: { description: "Malformed request", content: { "application/json": { schema: error } } },
            409: { description: "Custom name already taken", content: { "application/json": { schema: error } } },
            422: { description: "Unsafe or invalid URL, slug or expiry", content: { "application/json": { schema: error } } },
            429: { description: "Rate limited; see Retry-After", content: { "application/json": { schema: error } } },
          },
        },
      },
      "/api/links/{slug}": {
        parameters: [slug],
        get: {
          operationId: "getLinkStats",
          summary: "Stats for a link",
          security: [{ manageToken: [] }],
          parameters: [{ name: "days", in: "query", schema: { type: "integer", minimum: 1, maximum: 365, default: 30 } }],
          responses: { 200: { description: "Stats", content: { "application/json": { schema: { $ref: "#/components/schemas/Stats" } } } }, 404: notFound },
        },
        patch: {
          operationId: "setLinkDisabled",
          summary: "Turn a link off or back on",
          security: [{ manageToken: [] }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["disabled"], properties: { disabled: { type: "boolean" } } } } } },
          responses: { 200: { description: "Updated" }, 400: { description: "Malformed request" }, 404: notFound },
        },
        delete: {
          operationId: "deleteLink",
          summary: "Delete a link and its stats",
          security: [{ manageToken: [] }],
          responses: { 204: { description: "Deleted" }, 404: notFound },
        },
      },
    },
  };
}
