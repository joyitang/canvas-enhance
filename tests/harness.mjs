/**
 * harness.mjs — drives the isolated Obsidian test instance over CDP with real
 * input events (Input.dispatchMouseEvent / dispatchKeyEvent). This is the
 * difference between "the code compiles" and "the interaction actually works".
 */

const PORT = process.env.CDP_PORT || 9333;

export async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const pages = list.filter((t) => t.type === "page");
  const target = pages.find((t) => t.url.includes("app://obsidian.md")) || pages[0];
  if (!target) throw new Error("no Obsidian page target on port " + PORT);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = (e) => rej(new Error("ws: " + e.message));
  });

  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    } else if (msg.method && listeners.has(msg.method)) {
      for (const fn of listeners.get(msg.method)) fn(msg.params);
    }
  };

  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
  };

  await send("Runtime.enable");
  await send("Page.enable");

  const consoleErrors = [];
  on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error") {
      consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
  });
  on("Runtime.exceptionThrown", (p) => {
    consoleErrors.push("EXCEPTION " + (p.exceptionDetails?.exception?.description ?? ""));
  });

  async function evaluate(expression, { awaitPromise = true } = {}) {
    const out = await send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (out.exceptionDetails) {
      const desc = out.exceptionDetails.exception?.description || out.exceptionDetails.text;
      throw new Error("eval failed: " + desc);
    }
    return out.result?.value;
  }

  const call = (fn, ...args) =>
    evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);

  async function mouse(type, x, y, opts = {}) {
    await send("Input.dispatchMouseEvent", {
      type,
      x: Math.round(x),
      y: Math.round(y),
      button: opts.button ?? "left",
      buttons: opts.buttons ?? (type === "mouseReleased" ? 0 : 1),
      clickCount: opts.clickCount ?? 1,
      pointerType: "mouse",
      modifiers: opts.modifiers ?? 0,
    });
  }

  async function click(x, y, opts = {}) {
    await mouse("mouseMoved", x, y, { buttons: 0 });
    await mouse("mousePressed", x, y, opts);
    await mouse("mouseReleased", x, y, opts);
  }

  async function clickRight(x, y) {
    await mouse("mouseMoved", x, y, { buttons: 0, button: "none" });
    await mouse("mousePressed", x, y, { button: "right", buttons: 2 });
    await mouse("mouseReleased", x, y, { button: "right", buttons: 0 });
  }

  async function drag(x1, y1, x2, y2, steps = 12) {
    await mouse("mouseMoved", x1, y1, { buttons: 0 });
    await mouse("mousePressed", x1, y1, { buttons: 1 });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await mouse("mouseMoved", x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, { buttons: 1 });
      await new Promise((r) => setTimeout(r, 12));
    }
    await mouse("mouseReleased", x2, y2, { buttons: 0 });
  }

  async function key(keyName, opts = {}) {
    const base = {
      key: keyName,
      code: opts.code ?? keyCode(keyName),
      windowsVirtualKeyCode: opts.vk ?? vkOf(keyName),
      nativeVirtualKeyCode: opts.vk ?? vkOf(keyName),
      modifiers: opts.modifiers ?? 0,
    };
    await send("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: opts.text });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  async function typeText(text) {
    for (const ch of text) {
      await send("Input.dispatchKeyEvent", {
        type: "char",
        key: ch,
        text: ch,
        unmodifiedText: ch,
      });
    }
  }

  async function shot(path) {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    const fs = await import("node:fs");
    fs.writeFileSync(path, Buffer.from(data, "base64"));
    return path;
  }

  return { send, on, evaluate, call, mouse, click, clickRight, drag, key, typeText, shot, consoleErrors, close: () => ws.close() };
}

function keyCode(k) {
  if (k === "Tab") return "Tab";
  if (k === "Escape") return "Escape";
  if (k === "Enter") return "Enter";
  return "Key" + k.toUpperCase();
}

function vkOf(k) {
  if (k === "Tab") return 9;
  if (k === "Escape") return 27;
  if (k === "Enter") return 13;
  if (k === "Backspace") return 8;
  if (k.length === 1) return k.toUpperCase().charCodeAt(0);
  return 0;
}
