import { spawn } from "node:child_process";

// Local development and preview use the same verified WCS reader as preparation.
export function soilMiddleware(request, response, next) {
  if (request.url !== "/api/soil") return next();
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
    let boundary;
    try {
      boundary = JSON.parse(body);
      if (boundary.type !== "Polygon") throw new Error();
    } catch {
      response.writeHead(400).end();
      return;
    }
    const child = spawn(
      process.env.AGRONA_PYTHON || "python",
      ["-X", "utf8", "-m", "scripts.field_data.soil_request"],
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
    child.stdin.end(JSON.stringify(boundary));
  });
}
