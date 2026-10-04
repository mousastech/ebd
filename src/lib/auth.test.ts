import { describe, expect, it } from "vitest";
import { createToken, readToken } from "./auth";
import { hashPassword, verifyPassword } from "./password";

describe("senhas", () => {
  it("aceita a senha correta e rejeita a errada", () => {
    const h = hashPassword("ebd-segura-123");
    expect(verifyPassword("ebd-segura-123", h)).toBe(true);
    expect(verifyPassword("ebd-segura-124", h)).toBe(false);
  });

  it("usa sal: o mesmo texto gera hashes diferentes", () => {
    expect(hashPassword("igual")).not.toBe(hashPassword("igual"));
  });

  it("hash malformado nunca autentica", () => {
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "sem-dois-pontos")).toBe(false);
  });
});

describe("cookie de sessão", () => {
  const now = Date.UTC(2026, 9, 4, 12);

  it("round-trip devolve o id do usuário", () => {
    expect(readToken(createToken(42, now), now + 1000)).toBe(42);
  });

  it("expira depois de 12 horas", () => {
    const t = createToken(42, now);
    expect(readToken(t, now + 11 * 3600e3)).toBe(42);
    expect(readToken(t, now + 13 * 3600e3)).toBeNull();
  });

  it("rejeita payload adulterado (troca de usuário)", () => {
    const [payload, sig] = createToken(42, now).split(".");
    const forged = Buffer.from(JSON.stringify({ u: 1, exp: now + 3600e3 })).toString("base64url");
    expect(forged).not.toBe(payload);
    expect(readToken(`${forged}.${sig}`, now)).toBeNull();
  });

  it("rejeita assinatura inválida, vazia ou ausente", () => {
    const [payload] = createToken(42, now).split(".");
    expect(readToken(`${payload}.assinatura-falsa`, now)).toBeNull();
    expect(readToken(`${payload}.`, now)).toBeNull();
    expect(readToken(payload, now)).toBeNull();
    expect(readToken(undefined, now)).toBeNull();
    expect(readToken("", now)).toBeNull();
  });
});
