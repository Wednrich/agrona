import { spawn } from "node:child_process";

// Local development and preview use the same verified WCS reader as preparation.
export function fieldDataMiddleware(request, response, next) {
  const legacySoil = request.url === "/api/soil";
  if (!legacySoil && request.url !== "/api/field-data") return next();
  if (request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > 64000) request.destroy();
  });
  request.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(body);
      const boundary = legacySoil ? payload : payload.boundary;
      if (boundary?.type !== "Polygon") throw new Error();
    } catch {
      response.writeHead(400).end();
      return;
    }
    const child = spawn(
      process.env.AGRONA_PYTHON || "python",
      [
        "-X",
        "utf8",
        "-m",
        legacySoil
          ? "scripts.field_data.soil_request"
          : "scripts.field_data.live",
      ],
      {
        windowsHide: true,
        timeout: 180000,
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.resume();
    const fail = () => {
      if (!response.writableEnded) response.writeHead(503).end();
    };
    child.on("error", fail);
    child.on("close", (code) => {
      if (code !== 0) return fail();
      if (!response.writableEnded) {
        response.setHeader("Content-Type", "application/json");
        response.end(output);
      }
    });
    child.stdin.on("error", fail);
    response.on("close", () => {
      if (!response.writableEnded) child.kill();
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
