"use client";
import { useState } from "react";
import { hmToMinutes, minutesToHm } from "@/core/scheduling/durationFormat";

const fieldStyle: React.CSSProperties = {
  width: "56px",
  textAlign: "center",
};

// Input de duração em horas+minutos, reutilizado nos formulários de tratamento
// e agendamento manual. Evita o erro comum de digitar "2" pensando em horas
// num campo que só aceita minutos (ex: 2 min em vez de 120 min).
//
// Modo não controlado (uso em <form action={serverAction}>): passe `name` +
// `defaultMinutes`; o total combinado vai num <input type="hidden"> com esse name.
// Modo controlado: passe `minutes` + `onChangeMinutes`.
export function DurationHoursInput({
  name,
  defaultMinutes,
  minutes,
  onChangeMinutes,
  inputStyle,
  labelStyle,
  required,
}: {
  name?: string;
  defaultMinutes?: number;
  minutes?: number;
  onChangeMinutes?: (totalMinutes: number) => void;
  inputStyle?: React.CSSProperties;
  labelStyle?: React.CSSProperties;
  required?: boolean;
}) {
  const isControlled = minutes !== undefined && onChangeMinutes !== undefined;
  const initial = minutesToHm(defaultMinutes ?? minutes ?? 60);
  const [localHours, setLocalHours] = useState(initial.hours);
  const [localMinutes, setLocalMinutes] = useState(initial.minutes);

  const current = isControlled ? minutesToHm(minutes!) : { hours: localHours, minutes: localMinutes };

  function update(hours: number, mins: number) {
    if (isControlled) {
      onChangeMinutes!(hmToMinutes(hours, mins));
    } else {
      setLocalHours(hours);
      setLocalMinutes(mins);
    }
  }

  const totalMinutes = isControlled ? minutes! : hmToMinutes(localHours, localMinutes);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
      {!isControlled && name && (
        <input type="hidden" name={name} value={totalMinutes} />
      )}
      <input
        type="number"
        min={0}
        max={23}
        step={1}
        value={current.hours}
        onChange={(e) => update(Number(e.target.value) || 0, current.minutes)}
        required={required}
        style={{ ...fieldStyle, ...inputStyle }}
        aria-label="Horas"
      />
      <span style={{ fontSize: "12px", ...labelStyle }}>h</span>
      <input
        type="number"
        min={0}
        max={55}
        step={5}
        value={current.minutes}
        onChange={(e) => update(current.hours, Number(e.target.value) || 0)}
        style={{ ...fieldStyle, ...inputStyle }}
        aria-label="Minutos"
      />
      <span style={{ fontSize: "12px", ...labelStyle }}>min</span>
    </div>
  );
}
