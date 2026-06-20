import { CheckCircle2, Clock } from "lucide-react";

type Props = {
  automationRate: number;
  afterHoursCount: number;
  scheduledCount: number;
};

export function DashboardRingMetrics({
  automationRate,
  afterHoursCount,
  scheduledCount,
}: Props) {
  // SVG ring chart math — viewBox 0 0 48 48, radius fits stroke-width 4
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (automationRate / 100) * circumference;

  return (
    <div className="dashboard-ring-metrics">
      {/* Ring chart: Autonomia IA */}
      <div className="dashboard-ring-item">
        <div className="dashboard-ring-wrap">
          <svg viewBox="0 0 48 48">
            <circle cx="24" cy="24" r={radius} className="ring-bg" />
            <circle
              cx="24"
              cy="24"
              r={radius}
              className="ring-fg"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <span className="dashboard-ring-value">
            {automationRate.toFixed(1)}%
          </span>
        </div>
        <span className="dashboard-ring-label">Autonomia IA</span>
      </div>

      {/* Highlight: Msgs fora horário */}
      <div className="dashboard-ring-item">
        <span className="dashboard-ring-highlight warm">
          <Clock size={16} />
          {afterHoursCount}
        </span>
        <span className="dashboard-ring-label">Msgs fora horário</span>
      </div>

      {/* Highlight: Consultas marcadas */}
      <div className="dashboard-ring-item">
        <span className="dashboard-ring-highlight accent">
          <CheckCircle2 size={16} />
          {scheduledCount}
        </span>
        <span className="dashboard-ring-label">Consultas marcadas</span>
      </div>
    </div>
  );
}
