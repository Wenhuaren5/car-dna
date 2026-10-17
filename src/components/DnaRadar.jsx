/**
 * Six-axis market radar.
 *
 * Market Average is index 100. Each series value is a performance index relative to the scoped
 * in-budget average. The scale is a compact dynamic linear scale built from every valid point that
 * will be drawn, so 100 sits at a visible reference ring instead of near the centre of a fixed
 * 0-400 chart. Unknown values stay null and are omitted from the path; they are never plotted as 0.
 * Missing points also split the line instead of connecting across the missing axis.
 */

const COLORS = ['#b8ff54', '#78f0ba', '#ffb27a'];
const MARKET_COLOR = '#eafff4';
const IDEAL_COLOR = '#d0b8ff';
const SIZE = 420;
const HEIGHT = 372;
const CX = SIZE / 2;
const CY = 178;
const RADIUS = 140;
const LABEL_GAP = 24;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const formatTick = value => Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);

function radiusFor(index, scale) {
  if (!Number.isFinite(index)) return null;
  if (!scale) return clamp(index, 0, 100) / 100 * RADIUS;
  const min = Number.isFinite(Number(scale.minIndex)) ? Number(scale.minIndex) : 0;
  const max = Number.isFinite(Number(scale.maxIndex)) && Number(scale.maxIndex) > min
    ? Number(scale.maxIndex)
    : min + 1;
  return RADIUS * (clamp(index, min, max) - min) / (max - min);
}

const polar = (radius, index, count) => {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
  return [CX + Math.cos(angle) * radius, CY + Math.sin(angle) * radius];
};

const ringPoints = (index, count, scale) => {
  const radius = radiusFor(index, scale) ?? 0;
  return Array.from({length: count}, (_, item) => polar(radius, item, count).join(',')).join(' ');
};

const labelPosition = (index, count) => {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
  const x = CX + Math.cos(angle) * (RADIUS + LABEL_GAP);
  const y = CY + Math.sin(angle) * (RADIUS + LABEL_GAP);
  const anchor = Math.abs(Math.cos(angle)) < 0.2 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
  return {x, y: y + (Math.sin(angle) > 0.5 ? 8 : 0), anchor};
};

function seriesPath(item, axes, scale) {
  const values = axes.map((_, index) => {
    const raw = item?.values?.[index];
    if (raw === null || raw === undefined || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  });
  const points = values.map((value, index) => {
    const radius = radiusFor(value, scale);
    return radius === null ? null : polar(radius, index, axes.length);
  });
  return {values, points, complete: points.length > 0 && points.every(Boolean)};
}

/** Split a circular path at null axes so a missing value is never bridged. */
function pathSegments(points) {
  const segments = [];
  let current = [];
  for (const point of points) {
    if (point) current.push(point);
    else if (current.length) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length) segments.push(current);
  return segments;
}

export default function DnaRadar({
  axes = [],
  series = [],
  ideal = null,
  scale = null,
  marketAverage = 100,
  available = true,
}) {
  if (!axes.length) return null;
  const count = axes.length;
  const tickValues = Array.isArray(scale?.ticks) && scale.ticks.length ? scale.ticks : [25, 50, 75, 100];
  const ringValues = Array.from(new Set([...tickValues, marketAverage]))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const minIndex = Number.isFinite(Number(scale?.minIndex)) ? Number(scale.minIndex) : 0;
  const maxIndex = Number.isFinite(Number(scale?.maxIndex)) && Number(scale.maxIndex) > minIndex
    ? Number(scale.maxIndex)
    : Math.max(minIndex + 1, marketAverage);
  const isMarket = value => Math.abs(value - marketAverage) < 1e-6;
  const labelledTicks = ringValues.filter(value => isMarket(value)
    || Math.abs(value - minIndex) < 1e-6
    || Math.abs(value - maxIndex) < 1e-6);
  const idealPath = ideal ? seriesPath(ideal, axes, scale) : null;
  const hasIdeal = Boolean(idealPath?.points.some(Boolean));
  const seriesPaths = series.map((item, index) => ({
    item,
    color: item.color || COLORS[index % COLORS.length],
    path: seriesPath(item, axes, scale),
  }));
  const hasSeriesData = seriesPaths.some(entry => entry.path.points.some(Boolean));
  const caption = available
    ? scale
      ? `Scale ${formatTick(minIndex)}–${formatTick(maxIndex)} · 100 = in-budget average · Unknown omitted`
      : '100 = in-budget market average · Unknown omitted'
    : 'No in-budget sample · Market average unavailable';

  return (
    <figure className="dna-radar">
      <svg
        viewBox={`0 0 ${SIZE} ${HEIGHT}`}
        role="img"
        aria-label="Six-axis comparison against the in-budget market average of 100"
      >
        <title>Six-axis comparison against the in-budget market average</title>
        <desc>100 is the average among vehicles that meet your constraints and price band. Points outside the dashed 100 line perform above that average; points inside perform below it. Unknown values are omitted.</desc>
        {available && ringValues.filter(value => !isMarket(value)).map(value => (
          <polygon
            key={`ring-${value}`}
            points={ringPoints(value, count, scale)}
            className={`radar-ring ${value === maxIndex ? 'outer' : ''} ${value === minIndex ? 'inner' : ''}`}
          />
        ))}
        {axes.map((axis, index) => {
          const [x, y] = polar(RADIUS, index, count);
          return <line key={axis.key || axis.shortLabel} x1={CX} y1={CY} x2={x} y2={y} className="radar-spoke" />;
        })}
        {available && ringValues.filter(isMarket).map(value => (
          <polygon key="ring-market" points={ringPoints(value, count, scale)} className="radar-ring market" />
        ))}
        {available && labelledTicks.map(value => {
          const radius = radiusFor(value, scale);
          if (radius === null) return null;
          const market = isMarket(value);
          if (!market && radius < 14) return null;
          return (
            <text key={`tick-${value}`} x={CX + 4} y={CY - radius + 3} className={`radar-tick ${market ? 'market' : ''}`}>
              {formatTick(value)}{market ? ' avg' : ''}
            </text>
          );
        })}
        {available && seriesPaths.map(({item, color, path}, seriesIndex) => (
          <g key={item.key || item.name || seriesIndex} style={{'--series-color': color}}>
            {path.complete ? (
              <polygon
                points={path.points.map(point => point.join(',')).join(' ')}
                className={`radar-series ${seriesIndex === 0 ? 'rank-1' : ''}`}
                fill={color}
              />
            ) : (
              pathSegments(path.points).filter(segment => segment.length > 1).map((segment, index) => (
                <polyline
                  key={`segment-${index}`}
                  points={segment.map(point => point.join(',')).join(' ')}
                  className="radar-series line"
                  stroke={color}
                  fill="none"
                />
              ))
            )}
            {path.points.map((point, index) => point && (
              <circle
                key={index}
                cx={point[0]}
                cy={point[1]}
                r={seriesIndex === 0 ? 3 : 2.5}
                fill={color}
                className="radar-dot"
              />
            ))}
          </g>
        ))}
        {available && idealPath && hasIdeal && (
          idealPath.complete ? (
            <polygon
              points={idealPath.points.map(point => point.join(',')).join(' ')}
              className="radar-ideal"
              style={{'--series-color': ideal.color || IDEAL_COLOR}}
            />
          ) : (
            pathSegments(idealPath.points).filter(segment => segment.length > 1).map((segment, index) => (
              <polyline
                key={`ideal-${index}`}
                points={segment.map(point => point.join(',')).join(' ')}
                className="radar-ideal line"
                fill="none"
                stroke={ideal.color || IDEAL_COLOR}
              />
            ))
          )
        )}
        {axes.map((axis, index) => {
          const position = labelPosition(index, count);
          return (
            <text key={axis.key || axis.shortLabel} x={position.x} y={position.y} textAnchor={position.anchor} className="radar-label">
              {axis.shortLabel || axis.label}
            </text>
          );
        })}
        {!available && (
          <>
            <text x={CX} y={CY - 4} textAnchor="middle" className="radar-empty">No in-budget sample</text>
            <text x={CX} y={CY + 13} textAnchor="middle" className="radar-empty-note">Market average and indexes unavailable</text>
          </>
        )}
        <text x={CX} y={HEIGHT - 8} textAnchor="middle" className="radar-caption">{caption}</text>
      </svg>
      <figcaption>
        {available
          ? <span className="radar-market-key"><i />In-budget market average = 100</span>
          : <span className="radar-null-note">No in-budget sample to form a market average</span>}
        {available && hasIdeal && (
          <span className="radar-ideal-key" style={{'--series-color': ideal.color || IDEAL_COLOR}}>
            <i />{ideal.name || 'Your Ideal DNA'} · target
          </span>
        )}
        {available && seriesPaths.map(({item, color}, index) => (
          <span key={item.key || item.name || index} style={{'--series-color': color}}>
            <i />{item.name}{Number.isFinite(item.score) ? ` · DNA ${item.score}` : ''}
          </span>
        ))}
        {available && (hasSeriesData || hasIdeal) && (
          <span className="radar-null-note">Unknown values are omitted, not plotted as zero</span>
        )}
      </figcaption>
    </figure>
  );
}
