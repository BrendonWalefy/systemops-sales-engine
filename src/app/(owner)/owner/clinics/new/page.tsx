"use client";

import { useActionState } from "react";
import Link from "next/link";
import { onboardClinic, type OnboardingState } from "./actions";

const initialState: OnboardingState = { ok: false };

export default function NewClinicPage() {
  const [state, formAction, pending] = useActionState(onboardClinic, initialState);

  const errorFor = (field: string) => state.errors?.find((e) => e.field === field)?.message;

  return (
    <div style={{ padding: "24px", maxWidth: 720, margin: "0 auto" }}>
      <div className="product-topbar">
        <div>
          <p className="eyebrow">Owner Panel</p>
          <h1 style={{ margin: 0 }}>Nova clínica</h1>
        </div>
        <Link href="/owner" className="secondary-button">
          Voltar
        </Link>
      </div>

      {state.message && (
        <div className="panel" style={{ borderColor: "var(--danger, #b00020)", marginBottom: 16 }}>
          {state.message}
        </div>
      )}

      <form action={formAction}>
        <section className="panel" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Identificação</h2>
          <div className="form-stack">
            <label>
              Nome da clínica
              <input name="name" required placeholder="Clínica Exemplo" />
              {errorFor("name") && <small style={{ color: "var(--danger,#b00020)" }}>{errorFor("name")}</small>}
            </label>
            <label>
              Slug (URL, sem espaços)
              <input name="slug" required placeholder="clinica-exemplo" pattern="[a-z0-9-]+" />
              {errorFor("slug") && <small style={{ color: "var(--danger,#b00020)" }}>{errorFor("slug")}</small>}
            </label>
            <label>
              Especialidade
              <input name="specialty" placeholder="estetica / odontology / dermatologia" defaultValue="odontology" />
            </label>
            <label>
              Fuso horário
              <input name="timezone" defaultValue="America/Sao_Paulo" />
            </label>
            <label>
              Horário comercial
              <input name="businessHours" placeholder="Seg-Sex 09:00-18:00" />
            </label>
            <label>
              Saudação
              <input name="greetingMessage" placeholder="Olá! Seja bem-vindo." />
            </label>
          </div>
        </section>

        <section className="panel" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Canal do WhatsApp</h2>
          <div className="form-stack">
            <label>
              Provedor
              <select name="provider" defaultValue="z_api">
                <option value="z_api">Z-API</option>
                <option value="meta_cloud_api">Meta Cloud API</option>
              </select>
            </label>
            <label>
              Z-API: Instance ID
              <input name="zapiInstanceId" placeholder="instância da clínica" />
            </label>
            <label>
              Z-API: Token
              <input name="zapiToken" />
            </label>
            <label>
              Z-API: Client Token (opcional)
              <input name="zapiClientToken" />
            </label>
            <label>
              Meta: Phone Number ID
              <input name="metaPhoneNumberId" />
            </label>
            <label>
              Meta: Access Token
              <input name="metaAccessToken" />
            </label>
            {errorFor("channel.zapi") && (
              <small style={{ color: "var(--danger,#b00020)" }}>{errorFor("channel.zapi")}</small>
            )}
            {errorFor("channel.meta") && (
              <small style={{ color: "var(--danger,#b00020)" }}>{errorFor("channel.meta")}</small>
            )}
          </div>
        </section>

        <section className="panel" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Playbook inicial</h2>
          <div className="form-stack">
            <label>
              Política comercial <strong>(obrigatória)</strong>
              <textarea
                name="commercialPolicy"
                required
                rows={3}
                placeholder="Aceitamos PIX, débito, crédito e parcelamento em até 12x."
              />
              {errorFor("playbook.commercialPolicy") && (
                <small style={{ color: "var(--danger,#b00020)" }}>{errorFor("playbook.commercialPolicy")}</small>
              )}
            </label>
            <label>
              Tom de voz
              <input name="toneOfVoice" defaultValue="acolhedor" />
            </label>
            <label>
              Orientações livres (notes)
              <textarea name="notes" rows={3} placeholder="Sempre confirmar o procedimento antes de oferecer horário." />
            </label>
          </div>
        </section>

        <section className="panel" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Acesso do dono da clínica</h2>
          <div className="form-stack">
            <label>
              E-mail do admin da clínica
              <input name="adminEmail" type="email" required placeholder="dono@clinica.com.br" />
              {errorFor("admins.0.email") && (
                <small style={{ color: "var(--danger,#b00020)" }}>{errorFor("admins.0.email")}</small>
              )}
            </label>
          </div>
        </section>

        <button type="submit" className="primary-button" disabled={pending}>
          {pending ? "Criando..." : "Criar clínica"}
        </button>
      </form>
    </div>
  );
}
