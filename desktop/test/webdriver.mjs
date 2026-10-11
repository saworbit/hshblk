/**
 * Just enough W3C WebDriver to drive the app through tauri-driver: a session, scripts in
 * the page, and real pointer input, which WebKit's driver delivers as the user's own.
 */
import { spawn } from "node:child_process";

const ROOT = "http://127.0.0.1:4444";

/** The WebDriver code points for keys that are not characters. */
export const Key = { Control: "\uE009", Enter: "\uE007", Escape: "\uE00C" };

/**
 * Starts tauri-driver in front of WebKitWebDriver. Stop it when done. The apps it launches
 * start in `cwd`.
 */
export async function startDriver({ cwd } = {}) {
  const driver = spawn(
    "tauri-driver",
    ["--port", "4444", "--native-driver", "/usr/bin/WebKitWebDriver"],
    { cwd, stdio: "ignore" },
  );
  for (let tries = 0; tries < 100; tries += 1) {
    try {
      await fetch(`${ROOT}/status`);
      return () => driver.kill();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  driver.kill();
  throw new Error("tauri-driver did not start");
}

/** Opens the app on a file and returns a session in its window. */
export async function launch(application, args) {
  const { sessionId } = await call("POST", "/session", {
    capabilities: { alwaysMatch: { "tauri:options": { application, args } } },
  });
  return new Session(sessionId);
}

class Session {
  #path;

  constructor(id) {
    this.#path = `/session/${id}`;
  }

  /** Runs a function in the page. It is sent as source, so it may not close over anything. */
  run(fn, ...args) {
    return call("POST", `${this.#path}/execute/sync`, {
      script: `return (${fn}).apply(null, arguments)`,
      args,
    });
  }

  /** Waits for a function in the page to return something truthy, and returns it. */
  async until(fn, ...args) {
    for (let tries = 0; tries < 100; tries += 1) {
      const value = await this.run(fn, ...args);
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`timed out waiting for ${fn}`);
  }

  click(x, y) {
    return this.#pointer([
      move(x, y),
      { type: "pointerDown", button: 0 },
      { type: "pointerUp", button: 0 },
    ]);
  }

  /** A click with a key held: `clickWith(Key.Control, x, y)`. */
  clickWith(key, x, y) {
    const pause = { type: "pause" };
    return call("POST", `${this.#path}/actions`, {
      actions: [
        {
          type: "key",
          id: "keyboard",
          actions: [
            { type: "keyDown", value: key },
            pause,
            pause,
            pause,
            { type: "keyUp", value: key },
          ],
        },
        {
          type: "pointer",
          id: "mouse",
          parameters: { pointerType: "mouse" },
          actions: [
            pause,
            move(x, y),
            { type: "pointerDown", button: 0 },
            { type: "pointerUp", button: 0 },
            pause,
          ],
        },
      ],
    });
  }

  drag(from, to) {
    return this.#pointer([
      move(from.x, from.y),
      { type: "pointerDown", button: 0 },
      move((from.x + to.x) / 2, (from.y + to.y) / 2),
      move(to.x, to.y),
      { type: "pointerUp", button: 0 },
    ]);
  }

  keys(text) {
    const actions = [...text].flatMap((value) => [
      { type: "keyDown", value },
      { type: "keyUp", value },
    ]);
    return call("POST", `${this.#path}/actions`, {
      actions: [{ type: "key", id: "keyboard", actions }],
    });
  }

  /** Presses keys together and lets them go in reverse: `press(Key.Control, "c")`. */
  press(...keys) {
    const actions = [
      ...keys.map((value) => ({ type: "keyDown", value })),
      ...keys.toReversed().map((value) => ({ type: "keyUp", value })),
    ];
    return call("POST", `${this.#path}/actions`, {
      actions: [{ type: "key", id: "keyboard", actions }],
    });
  }

  screenshot() {
    return call("GET", `${this.#path}/screenshot`).then((png) => Buffer.from(png, "base64"));
  }

  close() {
    return call("DELETE", this.#path);
  }

  #pointer(actions) {
    return call("POST", `${this.#path}/actions`, {
      actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions }],
    });
  }
}

function move(x, y) {
  return {
    type: "pointerMove",
    origin: "viewport",
    x: Math.round(x),
    y: Math.round(y),
    duration: 50,
  };
}

async function call(method, path, body) {
  const response = await fetch(`${ROOT}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const { value } = await response.json();
  if (value?.error) throw new Error(`${value.error}: ${value.message}`);
  return value;
}
