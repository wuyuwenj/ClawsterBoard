import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchAnalytics, type AnalyticsData, type AnalyticsDay } from "./api";

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const wholeNumber = new Intl.NumberFormat("en-US");
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function formatDayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function fillRecentDays(days: AnalyticsDay[], totalDays = 30): Array<AnalyticsDay & { label: string }> {
  const byDate = new Map(days.map((day) => [day.date, day.messageCount]));
  const filled: Array<AnalyticsDay & { label: string }> = [];

  for (let offset = totalDays - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setUTCHours(12, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - offset);
    const isoDate = date.toISOString().slice(0, 10);

    filled.push({
      date: isoDate,
      label: formatDayLabel(isoDate),
      messageCount: byDate.get(isoDate) ?? 0,
    });
  }

  return filled;
}

function weekDeltaLabel(current: number, previous: number): string {
  const diff = current - previous;
  if (diff === 0) return "No change from last week";
  if (previous === 0) return `${diff > 0 ? "+" : ""}${diff} from last week`;
  const percent = Math.round((diff / previous) * 100);
  return `${diff > 0 ? "+" : ""}${percent}% vs last week`;
}

export default function StatsView() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAnalytics() {
      setLoading(true);
      setError(null);

      try {
        const next = await fetchAnalytics();
        if (!cancelled) {
          setData(next);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load analytics");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadAnalytics();
    return () => {
      cancelled = true;
    };
  }, []);

  const messagesPerDay = useMemo(
    () => fillRecentDays(data?.messagesPerDay ?? []),
    [data]
  );

  if (loading) {
    return <div className="stats-loading">Loading analytics...</div>;
  }

  if (error || !data) {
    return (
      <div className="stats-error">
        <p>Analytics could not be loaded.</p>
        {error && <span>{error}</span>}
      </div>
    );
  }

  return (
    <div className="stats-view">
      <div className="stats-heading">
        <div>
          <h2>Analytics Overview</h2>
          <p>Session activity, message volume, and token spend across your Claude Code history.</p>
        </div>
      </div>

      <section className="stats-grid">
        <article className="stat-card stat-card-accent">
          <span className="stat-label">Sessions This Week</span>
          <strong className="stat-value">{wholeNumber.format(data.sessionsThisWeek)}</strong>
          <span className={`stat-trend ${data.sessionsThisWeek >= data.sessionsLastWeek ? "positive" : "negative"}`}>
            {weekDeltaLabel(data.sessionsThisWeek, data.sessionsLastWeek)}
          </span>
        </article>

        <article className="stat-card">
          <span className="stat-label">Total Sessions</span>
          <strong className="stat-value">{wholeNumber.format(data.totalSessions)}</strong>
          <span className="stat-footnote">
            {wholeNumber.format(data.sessionsLastWeek)} sessions were started last week
          </span>
        </article>

        <article className="stat-card">
          <span className="stat-label">Total Tokens</span>
          <strong className="stat-value">{compactNumber.format(data.totalTokens)}</strong>
          <span className="stat-footnote">
            In {compactNumber.format(data.tokenTotals.inputTokens)} / Out {compactNumber.format(data.tokenTotals.outputTokens)}
          </span>
        </article>

        <article className="stat-card">
          <span className="stat-label">Estimated Cost</span>
          <strong className="stat-value">{currency.format(data.estimatedCost)}</strong>
          <span className="stat-footnote">
            Cache read {compactNumber.format(data.tokenTotals.cacheReadTokens)} / write {compactNumber.format(data.tokenTotals.cacheCreationTokens)}
          </span>
        </article>
      </section>

      <section className="chart-grid">
        <article className="chart-section">
          <div className="chart-header">
            <div>
              <h3>Messages Per Day</h3>
              <p>Last 30 days of session starts, aggregated by recorded message count.</p>
            </div>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={messagesPerDay}>
                <defs>
                  <linearGradient id="messagesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#58a6ff" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#58a6ff" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#30363d" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#8b949e", fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fill: "#8b949e", fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    background: "#161b22",
                    border: "1px solid #30363d",
                    borderRadius: "8px",
                    color: "#e6edf3",
                  }}
                  labelStyle={{ color: "#e6edf3" }}
                  formatter={(value: number) => [wholeNumber.format(value), "Messages"]}
                />
                <Area
                  type="monotone"
                  dataKey="messageCount"
                  stroke="#58a6ff"
                  strokeWidth={2}
                  fill="url(#messagesFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="chart-section">
          <div className="chart-header">
            <div>
              <h3>Most Active Projects</h3>
              <p>Top projects by session count. Hover a bar to compare messages and sessions.</p>
            </div>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.activeProjects} layout="vertical" margin={{ left: 12, right: 12 }}>
                <CartesianGrid stroke="#30363d" strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: "#8b949e", fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="projectName"
                  tick={{ fill: "#e6edf3", fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={110}
                />
                <Tooltip
                  cursor={{ fill: "rgba(88, 166, 255, 0.08)" }}
                  contentStyle={{
                    background: "#161b22",
                    border: "1px solid #30363d",
                    borderRadius: "8px",
                    color: "#e6edf3",
                  }}
                  formatter={(value: number, name: string, item: { payload?: { messageCount?: number } }) => {
                    if (name === "sessionCount") {
                      return [
                        `${wholeNumber.format(value)} sessions`,
                        `${wholeNumber.format(item.payload?.messageCount ?? 0)} messages`,
                      ];
                    }
                    return [wholeNumber.format(value), name];
                  }}
                  labelFormatter={(label) => `${label}`}
                />
                <Bar
                  dataKey="sessionCount"
                  name="sessionCount"
                  radius={[0, 8, 8, 0]}
                  fill="#3fb950"
                  barSize={18}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>
    </div>
  );
}
