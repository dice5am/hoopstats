"use client";

import { useState } from "react";
import { formatSigned } from "@/lib/insightsTypes";
import {
  DRIVER_LABELS,
  type DriverModel,
  type Lens,
  type ModelKey,
  type PointsDriversData,
} from "@/lib/pointsDriversTypes";
import {
  SEGMENT_SWITCH_LABEL,
  TIMESPAN_SWITCH_LABEL,
  type SegmentKey,
  type TimespanKey,
} from "@/lib/timespans";
import styles from "./PointsDrivers.module.css";

const LENS_LABEL: Record<Lens, string> = {
  pregame: "Pregame",
  explanatory: "Same game",
};
const LENS_SUB: Record<Lens, string> = {
  pregame: "betting view",
  explanatory: "explanatory",
};
const MODEL_LABEL: Record<ModelKey, string> = {
  mixedlm: "Mixed model",
  ols: "OLS",
};

function niceStep(span: number): number {
  const rough = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1e-6))));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (rough <= m * mag) return m * mag;
  }
  return 10 * mag;
}

function axisFor(model: DriverModel): { min: number; max: number; ticks: number[] } {
  let lo = 0;
  let hi = 0;
  for (const d of model.drivers) {
    if (d.lo != null) lo = Math.min(lo, d.lo);
    if (d.hi != null) hi = Math.max(hi, d.hi);
  }
  const step = niceStep(Math.max(hi - lo, 0.2));
  const min = Math.floor(lo / step - 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step * 1e-6; v += step) {
    ticks.push(Math.abs(v) < step * 1e-6 ? 0 : Number(v.toPrecision(6)));
  }
  return { min, max, ticks };
}

function tickText(v: number, step: number): string {
  if (v === 0) return "0";
  return formatSigned(v, step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
}

function pct(a: number, b: number): number {
  return ((b - a) / b) * 100;
}

function fitLine(lens: Lens, m: DriverModel): string {
  if (m.test_mae == null || m.baseline_mae == null) return "";
  const mae = `MAE ${m.test_mae.toFixed(2)} vs ${m.baseline_mae.toFixed(2)} pts`;
  const r2 =
    m.test_r2 != null && m.baseline_r2 != null
      ? `; R² ${m.test_r2.toFixed(3)} vs ${m.baseline_r2.toFixed(3)}`
      : "";
  const tail =
    lens === "explanatory"
      ? " The baseline is for reference only: same-game inputs are not a like-for-like forecast."
      : "";
  return `Model vs prior-season-average baseline, held-out last 20% of dates: ${mae}${r2}.${tail}`;
}

export function PointsDrivers({
  data,
  timespan,
  segment,
}: {
  data: PointsDriversData;
  timespan: TimespanKey;
  segment: SegmentKey;
}) {
  const [lens, setLens] = useState<Lens>("pregame");
  const [modelKey, setModelKey] = useState<ModelKey>("mixedlm");

  const cell = data.cells[lens]?.[timespan]?.[segment];
  const hasOls = !!cell?.models.ols;
  const model = cell?.models[modelKey] ?? cell?.models.mixedlm;
  const activeKey: ModelKey = cell?.models[modelKey] ? modelKey : "mixedlm";
  const split = data.date_split[timespan];
  const tsLabel = TIMESPAN_SWITCH_LABEL[timespan];
  const segLabel = SEGMENT_SWITCH_LABEL[segment];

  const bars = model ? axisFor(model) : null;
  const step = bars && bars.ticks.length > 1 ? bars.ticks[1] - bars.ticks[0] : 1;

  const gain =
    lens === "pregame" && model?.test_mae != null && model.baseline_mae != null
      ? pct(model.test_mae, model.baseline_mae)
      : null;

  const defaultPre = data.cells.pregame.pooled_2023_26?.all?.models.mixedlm;
  const defaultGain =
    defaultPre?.test_mae != null && defaultPre.baseline_mae != null
      ? pct(defaultPre.test_mae, defaultPre.baseline_mae)
      : null;
  const beats = data.pregame_beats_baseline_mae;

  return (
    <section className={styles.section} aria-labelledby="pd-h">
      <h2 id="pd-h" className={styles.h2}>
        Points drivers
      </h2>
      <p className={styles.story}>
        Which box-score measures are <em>associated with</em> a player&apos;s
        points, holding the others fixed. Associations only, not causes. Effect
        = change in points per +1 standard deviation of the measure.
      </p>

      <div className={styles.switch} role="tablist" aria-label="Lens">
        {(["pregame", "explanatory"] as Lens[]).map((l) => (
          <button
            key={l}
            type="button"
            role="tab"
            aria-selected={lens === l}
            className={lens === l ? styles.tabOn : styles.tab}
            onClick={() => setLens(l)}
          >
            <span>{LENS_LABEL[l]}</span>
            <span className={styles.tabSub}>{LENS_SUB[l]}</span>
          </button>
        ))}
      </div>

      <p className={styles.lensNote}>
        {lens === "pregame"
          ? "Inputs are each player's averages over his previous 10 games only, so everything is known before tip-off."
          : "Inputs are the same game's box-score measures. These describe how points get produced; they are not pregame predictors."}
      </p>

      <div className={styles.metaRow}>
        <p className={styles.cellNote}>
          {tsLabel} · {segLabel}
          {cell ? ` · ${cell.n_players} players, ${cell.n_games.toLocaleString("en-US")} player-games` : ""}
        </p>
        {hasOls ? (
          <div className={styles.modelSwitch} role="tablist" aria-label="Model">
            {(["mixedlm", "ols"] as ModelKey[]).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={activeKey === k}
                className={activeKey === k ? styles.miniOn : styles.mini}
                onClick={() => setModelKey(k)}
              >
                {MODEL_LABEL[k]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!cell || !cell.fitted || cell.thin || !model || !bars ? (
        <div className={styles.thin} role="status">
          <p className={styles.thinH}>Too few games to rank</p>
          <p className={styles.thinP}>
            {cell && !cell.fitted
              ? `${tsLabel} ${segLabel} has only ${cell.n_players} players and ${cell.n_games} player-games, too few to fit a model at all.`
              : cell
                ? `${segLabel} has only ${cell.n_players} players (${cell.n_games.toLocaleString("en-US")} player-games). Cells under 30 players are not ranked, because a handful of players would set the order.`
                : "No fitted cell for this timespan and segment."}{" "}
            Try All, Top 100 or Top 50.
          </p>
        </div>
      ) : (
        <>
          <ol className={styles.bars} aria-label={`${LENS_LABEL[lens]} drivers, ${MODEL_LABEL[activeKey]}`}>
            {model.drivers.map((d) => {
              if (d.coef == null || d.lo == null || d.hi == null) return null;
              const span = bars.max - bars.min;
              const x = (v: number) => ((v - bars.min) / span) * 100;
              const zero = x(0);
              const c = x(d.coef);
              const crosses = d.lo <= 0 && d.hi >= 0;
              const left = Math.min(zero, c);
              const width = Math.abs(c - zero);
              return (
                <li key={d.driver} className={styles.row}>
                  <span className={styles.lab}>
                    <span className={styles.rank}>{d.rank}</span>
                    {DRIVER_LABELS[d.driver] ?? d.driver}
                  </span>
                  <span className={styles.plot} aria-hidden="true">
                    {bars.ticks.map((t) => (
                      <span
                        key={t}
                        className={t === 0 ? styles.zero : styles.grid}
                        style={{ left: `${x(t)}%` }}
                      />
                    ))}
                    <span
                      className={crosses ? styles.barMuted : d.coef > 0 ? styles.barPos : styles.barNeg}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                    <span
                      className={styles.whisker}
                      style={{ left: `${x(d.lo)}%`, width: `${x(d.hi) - x(d.lo)}%` }}
                    />
                    <span className={styles.cap} style={{ left: `${x(d.lo)}%` }} />
                    <span className={styles.cap} style={{ left: `${x(d.hi)}%` }} />
                  </span>
                  <span className={styles.val}>
                    <span className={styles.valMain}>{formatSigned(d.coef)}</span>
                    <span className={styles.valCi}>
                      {formatSigned(d.lo)} to {formatSigned(d.hi)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
          <div className={styles.axisRow} aria-hidden="true">
            <span />
            <span className={styles.axis}>
              {bars.ticks.map((t) => (
                <span
                  key={t}
                  className={styles.tickLab}
                  style={{ left: `${((t - bars.min) / (bars.max - bars.min)) * 100}%` }}
                >
                  {tickText(t, step)}
                </span>
              ))}
            </span>
            <span />
          </div>
          <p className={styles.axisNote}>
            Points per +1 SD · whiskers = 95% CI · grey = CI includes 0 ·
            ranked by size of effect
            {activeKey === "mixedlm"
              ? " · player random-intercept model"
              : " · OLS, player-clustered CIs"}
          </p>

          <p className={styles.fit}>{fitLine(lens, model)}</p>
          {lens === "pregame" && gain != null ? (
            <p className={styles.read}>
              <strong>
                {gain >= 0
                  ? `Only ${gain.toFixed(1)}% lower error than just using the prior average.`
                  : `${Math.abs(gain).toFixed(1)}% higher error than just using the prior average.`}
              </strong>{" "}
              Pregame models add little over the prior season-to-date average
              {defaultGain != null
                ? ` (${defaultGain.toFixed(1)}% in the default 3-season, All cell for the mixed model)`
                : ""}
              : across the {beats.mixedlm.cells} non-thin cells the mixed model
              beat it on MAE in {beats.mixedlm.beat} and OLS in{" "}
              {beats.ols.beat}. Per-game scoring is mostly noise around a
              player&apos;s level.
            </p>
          ) : null}
          {lens === "explanatory" ? (
            <p className={styles.read}>
              <strong>This fit is near arithmetic, not forecasting skill.</strong>{" "}
              Points = 2 × TS% × (FGA + 0.44 × FTA), so those same-game
              measures account for points almost by construction
              {model.test_r2 != null
                ? ` (R² ${model.test_r2.toFixed(2)})`
                : ""}
              . It cannot be used to predict a game before it is played.
            </p>
          ) : null}
          {timespan === "2026_27" && split ? (
            <p className={styles.caveat}>
              2026-27 is provisional: the test window is only the last{" "}
              {split.n_test_dates} game dates (from {split.cutoff}).
            </p>
          ) : null}
        </>
      )}

      <div className={styles.notes}>
        <p>
          <strong>Left out.</strong> USG% and eFG% were dropped as
          near-duplicates of FGA, FTA, minutes and TS% (variance-inflation
          check; in the default cell, and other cells can drop further overlaps). Net rating equals off minus def rating exactly, so only the
          two parts are kept. PIE is dropped from the same-game lens because it
          contains the player&apos;s own points.
        </p>
        <p>
          <strong>Not in the data.</strong> Opponent or matchup, injuries and
          lineups, and betting lines. Those are what actually move a points
          prop, so these results describe box-score associations only.
        </p>
        <p>
          Data through {data.through ?? "—"}. Test split is by date (last 20%
          of game dates); top 25 and top 10 are never ranked.
        </p>
      </div>
    </section>
  );
}
