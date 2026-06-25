import { describe, it, expect } from "vitest";
import {
  emailToFirstName,
  greetingFromProfessionalName,
  resolveGreetingName,
} from "../app/(clinic)/app/dashboard/greeting";

describe("emailToFirstName", () => {
  it("captura o local-part e capitaliza", () => {
    expect(emailToFirstName("helena@clinica.com")).toBe("Helena");
  });

  it("corta em separadores e números", () => {
    expect(emailToFirstName("joao.pereira@x.com")).toBe("Joao");
    expect(emailToFirstName("maria_souza99@x.com")).toBe("Maria");
  });
});

describe("greetingFromProfessionalName", () => {
  it("mantém o título e o primeiro nome", () => {
    expect(greetingFromProfessionalName("Dra. Helena Marques")).toBe("Dra. Helena");
    expect(greetingFromProfessionalName("Dr. Gregorie Ximendes")).toBe("Dr. Gregorie");
  });

  it("usa só o primeiro nome quando não há título", () => {
    expect(greetingFromProfessionalName("João Pereira")).toBe("João");
  });
});

describe("resolveGreetingName", () => {
  it("prioriza o display_name explícito do membro", () => {
    expect(
      resolveGreetingName({
        displayName: "Dr. Gregorie",
        professionalName: "Dra. Helena Marques",
        email: "ximendesodonto@gmail.com",
      }),
    ).toBe("Dr. Gregorie");
  });

  it("cai para o profissional vinculado quando não há display_name", () => {
    expect(
      resolveGreetingName({
        displayName: null,
        professionalName: "Dra. Helena Marques",
        email: "helena@clinica.com",
      }),
    ).toBe("Dra. Helena");
  });

  it("cai para o e-mail quando não há display_name nem profissional", () => {
    expect(
      resolveGreetingName({
        displayName: "   ",
        professionalName: null,
        email: "ximendesodonto@gmail.com",
      }),
    ).toBe("Ximendesodonto");
  });

  it("retorna 'você' sem nenhuma fonte de nome", () => {
    expect(resolveGreetingName({})).toBe("você");
  });
});
