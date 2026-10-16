import { rmSync } from "node:fs";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createContext, readInventory } from "../../src/inventory.mjs";
import { createMatrix } from "../../src/matrix.mjs";
import { runTerminal } from "../../src/ui/terminal.mjs";
import { fixture } from "../helpers/fixture.js";

const roots: string[] = [];
function setup() {
  const files = fixture();
  roots.push(files.root);
  const matrix = createMatrix(readInventory(createContext(files)));
  const input = new PassThrough() as unknown as NodeJS.ReadStream;
  input.isRaw = false;
  input.setRawMode = (raw: boolean) => {
    input.isRaw = raw;
    return input;
  };
  const output = new PassThrough() as unknown as NodeJS.WriteStream;
  output.columns = 80;
  output.rows = 14;
  let text = "";
  output.on("data", (chunk) => {
    text += chunk.toString();
  });
  const key = (name: string, text = "") => input.emit("keypress", text, { name });
  return { matrix, input, output, key, text: () => text };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("terminal matrix", () => {
  it("requires explicit confirmation after editing a scope cell", async () => {
    const ui = setup();
    const result = runTerminal(ui.matrix, ui);
    ui.key("right");
    ui.key("space", " ");
    ui.key("return");
    expect(ui.text()).toContain("Review");
    expect(ui.input.isRaw).toBe(true);
    ui.key("y", "y");
    expect(await result).toEqual([
      {
        action: "install",
        scope: "global",
        name: "supi-agent",
        source: "npm:@mrclrchtr/supi-agent",
      },
    ]);
    expect(ui.input.isRaw).toBe(false);
    expect(ui.text()).toContain("\u001b[?25h");
  });

  it("scrolls through rows and applies a preset only to the focused scope", async () => {
    const ui = setup();
    const result = runTerminal(ui.matrix, ui);
    for (let index = 0; index < 16; index++) ui.key("down");
    expect(ui.text()).toContain("supi-web");
    ui.key("r", "r");
    ui.key("return");
    ui.key("y", "y");
    const plan = await result;
    expect(plan).toHaveLength(8);
    expect(plan?.every((operation) => operation.scope === "project")).toBe(true);
  });

  it("does not treat bracketed paste as edits or confirmation", async () => {
    const ui = setup();
    const result = runTerminal(ui.matrix, ui);
    ui.input.emit(
      "data",
      Buffer.concat([Buffer.from("\u001b[200~"), Buffer.from("a\ry"), Buffer.from("\u001b[201~")]),
    );
    expect(ui.matrix.rows.some((row) => row.selected.project)).toBe(false);
    ui.key("escape");
    await result;
  });

  it("restores the terminal after cancellation, resize, or input failure", async () => {
    const ui = setup();
    const result = runTerminal(ui.matrix, ui);
    ui.output.columns = 25;
    ui.output.emit("resize");
    expect(ui.text()).toContain("Resize");
    ui.key("escape");
    expect(await result).toBeNull();
    expect(ui.input.isRaw).toBe(false);
    const next = runTerminal(ui.matrix, ui);
    ui.input.emit("error", new Error("input failed"));
    await expect(next).rejects.toThrow("input failed");
    expect(ui.input.isRaw).toBe(false);
  });
});
