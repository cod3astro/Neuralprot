import { useState, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Dna, Brain, Layers, Hash, SlidersHorizontal, Filter, Eye } from 'lucide-react'
import SequenceInput   from '../components/prediction/SequenceInput'
import LoadingNarrator from '../components/prediction/LoadingNarrator'
import ResultsPanel    from '../components/prediction/ResultsPanel'
import { usePrediction } from '../hooks/usePrediction'

// ─────────────────────────────────────────────────────────────────────────────
// PRESET DEFINITIONS
// All 375 models are loaded into memory at startup and stay there.
// The f1Value is sent to the backend as `f1_threshold` in the POST body.
// The backend skips groups whose stored F1 < f1_threshold at predict time.
// Switching presets costs nothing, no reloading ever happens.
//
// Counts verified from model_f1_scores.json:
//   Broad    F1 >= 0.30  →  371 groups  (default, most coverage)
//   Balanced F1 >= 0.50  →  304 groups
//   Strict   F1 >= 0.70  →   99 groups  (highest confidence only)
// ─────────────────────────────────────────────────────────────────────────────
const PRESETS = [
  {
    key:        'broad',
    label:      'Broad',
    f1Value:    0.30,
    groupCount: 371,
    hint:       '371 model groups (F1 ≥ 0.30). Maximum coverage, best starting point for any new protein. All models loaded, only the lowest-quality 5 excluded.',
    color:      'teal',
    isDefault:  true,
  },
  {
    key:        'balanced',
    label:      'Balanced',
    f1Value:    0.50,
    groupCount: 304,
    hint:       '304 model groups (F1 ≥ 0.50). Removes weaker models for cleaner predictions. Good for most research tasks.',
    color:      'cyan',
  },
  {
    key:        'strict',
    label:      'Strict',
    f1Value:    0.70,
    groupCount: 99,
    hint:       'Only the top 99 model groups (F1 ≥ 0.70). Highest confidence, narrowest coverage. Best for publication-grade annotation of well-studied protein families.',
    color:      'violet',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// RESULT REFINEMENT (client-side only, nothing is deleted from `results`)
//
// The model filter above controls how many MODELS vote. It does not control
// how many TERMS each model outputs. Even 99 "Strict" models can still emit
// 200+ combined predictions if each fires 2-3 terms. This second filter
// narrows the DISPLAYED list without touching the underlying data, so the
// person can always flip back to "Show all" with one click.
//
// Two signals are used, both already present on every prediction object
// with zero extra backend calls:
//   1. confidence, keep only the model's most confident calls
//   2. group name, the "Fallback_*" groups are catch-all buckets built
//                      from leftover/unclustered GO terms (see go_group_
//                      assigner.py). They are inherently the least specific
//                      groups in the whole system, so they're deprioritized
//                      in the focused view first.
// ─────────────────────────────────────────────────────────────────────────────
const REFINE_CONFIDENCE_MIN = 0.80 // only show predictions the model is >=80% sure about
const REFINE_MAX_TERMS      = 60   // hard cap so the focused view stays scannable

function refinePredictions(predictions) {
  if (!predictions?.length) return []

  const isFallback = (r) => (r.group || '').startsWith('Fallback_')

  // Score each prediction: high confidence wins, non-Fallback groups win ties
  const ranked = [...predictions].sort((a, b) => {
    const fa = isFallback(a) ? 0 : 1
    const fb = isFallback(b) ? 0 : 1
    if (fa !== fb) return fb - fa            // non-Fallback first
    return (b.confidence ?? 0) - (a.confidence ?? 0)  // then by confidence
  })

  // Primary filter: confidence threshold, non-Fallback preferred
  let focused = ranked.filter(r => (r.confidence ?? 0) >= REFINE_CONFIDENCE_MIN)

  // If the confidence filter alone is still too generous, also drop Fallback terms
  if (focused.length > REFINE_MAX_TERMS) {
    const nonFallback = focused.filter(r => !isFallback(r))
    if (nonFallback.length > 0) focused = nonFallback
  }

  return focused.slice(0, REFINE_MAX_TERMS)
}

// ─────────────────────────────────────────────────────────────────────────────
// STAT PILL
// ─────────────────────────────────────────────────────────────────────────────
function StatPill({ icon: Icon, label, value, color }) {
  const colors = {
    teal:   'text-teal   bg-teal/10   border-teal/30',
    cyan:   'text-cyan   bg-cyan/10   border-cyan/30',
    violet: 'text-violet bg-violet/10 border-violet/30',
    gold:   'text-gold   bg-gold/10   border-gold/30',
  }
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${colors[color] || colors.teal}`}>
      <Icon size={13} className="flex-shrink-0" />
      <div className="min-w-0">
        <p className="font-mono font-bold text-sm leading-none">{value}</p>
        <p className="text-[10px] font-body opacity-70 mt-0.5 leading-none">{label}</p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL THRESHOLD SELECTOR
// ─────────────────────────────────────────────────────────────────────────────
function ModelThresholdSelector({ selected, onChange }) {
  const colorMap = {
    teal:   { active: 'bg-teal/10 border-teal/50 text-teal',       dot: 'bg-teal'   },
    cyan:   { active: 'bg-cyan/10 border-cyan/50 text-cyan',       dot: 'bg-cyan'   },
    violet: { active: 'bg-violet/10 border-violet/50 text-violet', dot: 'bg-violet' },
  }
  const inactive =
    'border-[var(--color-border)] text-[var(--color-text-muted)] ' +
    'hover:text-[var(--color-text)] hover:border-[var(--color-border-hover)]'

  const activePreset = PRESETS.find(p => p.key === selected)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <SlidersHorizontal size={11} className="text-[var(--color-text-muted)]" />
        <span className="text-[10px] font-mono text-[var(--color-text-muted)] uppercase tracking-widest">
          Model Quality Filter
        </span>
      </div>

      <div className="flex gap-2 flex-wrap">
        {PRESETS.map(preset => {
          const isActive = selected === preset.key
          const c        = colorMap[preset.color]
          return (
            <motion.button
              key={preset.key}
              onClick={() => onChange(preset.key)}
              title={preset.hint}
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full',
                'text-xs font-display font-semibold border transition-all duration-200 cursor-pointer',
                isActive ? c.active : inactive,
              ].join(' ')}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              aria-pressed={isActive}
            >
              {isActive && (
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
              )}
              {preset.label}
              <span className="opacity-50 font-normal font-mono text-[10px]">
                {preset.groupCount} Models
              </span>
            </motion.button>
          )
        })}
      </div>

      <AnimatePresence mode="wait">
        {activePreset && (
          <motion.p
            key={activePreset.key}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2 }}
            className="text-[10px] font-body text-[var(--color-text-muted)] leading-relaxed"
          >
            {activePreset.hint}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULT VIEW TOGGLE, "Focused" (filtered) vs "All" (raw backend output)
// ─────────────────────────────────────────────────────────────────────────────
function ResultViewToggle({ view, onChange, focusedCount, allCount }) {
  const options = [
    { key: 'focused', label: 'Focused', icon: Filter, count: focusedCount,
      hint: `Showing ${focusedCount} high-confidence, specific terms` },
    { key: 'all', label: 'Show all', icon: Eye, count: allCount,
      hint: `Showing all ${allCount} raw predictions from the selected models` },
  ]
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1 p-1 rounded-full border border-[var(--color-border)] bg-[var(--color-bg)]">
        {options.map(opt => {
          const isActive = view === opt.key
          return (
            <button
              key={opt.key}
              onClick={() => onChange(opt.key)}
              title={opt.hint}
              className={[
                'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-display font-semibold transition-all duration-200 cursor-pointer',
                isActive
                  ? 'bg-teal/15 text-teal'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
              ].join(' ')}
            >
              <opt.icon size={11} />
              {opt.label}
              <span className="opacity-60 font-mono text-[10px]">{opt.count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PREDICT PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function Predict() {
  const [currentSequence, setCurrentSequence] = useState('')
  // Default is 'broad', all sensible models, best starting coverage
  const [presetKey, setPresetKey]             = useState('broad')
  // Default result view is 'focused', the smaller, refined list
  const [resultView, setResultView]           = useState('focused')
  const { predict, predictBatch, loading, results, error } = usePrediction()
  const resultRef = useRef(null)

  const activePreset = PRESETS.find(p => p.key === presetKey) ?? PRESETS[0]
  const f1Threshold  = activePreset.f1Value

  const handleSubmit = async ({ type, sequence, file }) => {
    if (type === 'single') {
      setCurrentSequence(sequence)
      // f1_threshold is sent in the POST body, backend filters groups at predict time
      await predict(sequence, { f1_threshold: f1Threshold })
    } else {
      setCurrentSequence('')
      await predictBatch(file)
    }
    // Reset to the focused view for every new prediction
    setResultView('focused')
    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 200)
  }

  // All predictions exactly as returned by the backend, never mutated
  const allPredictions = results?.predictions ?? []

  // The smaller, refined list, computed client-side, nothing sent over the network again
  const focusedPredictions = useMemo(
    () => refinePredictions(allPredictions),
    [allPredictions]
  )

  // Whichever list is currently selected for display
  const displayedPredictions = resultView === 'focused' ? focusedPredictions : allPredictions

  const metrics = useMemo(() => {
    if (!results) return null
    const aiPreds = displayedPredictions.filter(r =>
      r.predicted_by === 'Neural Network AI' || r.predicted_by === 'Neural Network'
    )
    const groupsFired = new Set(aiPreds.map(r => r.group).filter(Boolean)).size
    const avgConf = aiPreds.length > 0
      ? (aiPreds.reduce((s, r) => s + (r.confidence ?? 0), 0) / aiPreds.length).toFixed(4)
      : '—'
    return {
      total:      displayedPredictions.length,
      groupsFired,
      // Use the real count the backend returns after filtering
      modelsUsed: results.modelsUsed ?? activePreset.groupCount,
      avgConf,
    }
  }, [results, displayedPredictions, activePreset])

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pt-24 pb-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">

        {/* ── Page header ── */}
        <motion.div
          className="text-center mb-8"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full
            border border-teal/30 bg-teal/5 mb-4">
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-teal"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.8, repeat: Infinity }}
            />
            <span className="text-[10px] font-mono text-teal tracking-widest uppercase">
              {activePreset.groupCount} Models Active
            </span>
          </div>
          <h1 className="font-display font-bold text-3xl sm:text-4xl text-[var(--color-text)] mb-2">
            Protein Function Predictor
          </h1>
          <p className="text-[var(--color-text-muted)] text-sm font-body">
            Paste a single amino acid sequence or upload a FASTA batch file
          </p>
        </motion.div>

        {/* ── Model quality threshold selector ── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="px-1"
        >
          <ModelThresholdSelector selected={presetKey} onChange={setPresetKey} />
        </motion.div>

        {/* ── Sequence / FASTA input ── */}
        <SequenceInput onSubmit={handleSubmit} demoSequence="" />

        {/* ── Loading narrator ── */}
        <AnimatePresence>
          {loading && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35 }}
            >
              <LoadingNarrator isVisible={true} sequence={currentSequence} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Error state ── */}
        <AnimatePresence>
          {error && !loading && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-start gap-3 p-4 rounded-xl border border-rose-500/30 bg-rose-500/5"
            >
              <Dna size={16} className="text-rose-400 flex-shrink-0 mt-0.5" />
              <p className="text-rose-400 text-xs font-mono leading-relaxed">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Results ── */}
        <AnimatePresence>
          {results && !loading && (
            <motion.div
              ref={resultRef}
              className="space-y-4"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              {metrics && (
                <motion.div
                  className="grid grid-cols-2 sm:grid-cols-4 gap-3"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1, duration: 0.35 }}
                >
                  <StatPill icon={Hash}   label="GO terms predicted" value={metrics.total.toLocaleString()} color="teal"   />
                  <StatPill icon={Brain}  label="Avg AI confidence"  value={metrics.avgConf}                color="cyan"   />
                  <StatPill icon={Layers} label="Groups activated"   value={`${metrics.groupsFired} / ${metrics.modelsUsed}`} color="violet" />
                  <StatPill icon={Dna}    label="Sequence length"    value={`${currentSequence.replace(/\s/g, '').length} aa`} color="gold" />
                </motion.div>
              )}

              {/* Focused / Show all toggle, sits right above the results list */}
              <motion.div
                className="flex items-center justify-between px-1"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15, duration: 0.3 }}
              >
                <p className="text-[10px] font-body text-[var(--color-text-muted)]">
                  Focused view hides low-confidence and very general terms. Switch anytime.
                </p>
                <ResultViewToggle
                  view={resultView}
                  onChange={setResultView}
                  focusedCount={focusedPredictions.length}
                  allCount={allPredictions.length}
                />
              </motion.div>

              <ResultsPanel results={displayedPredictions} totalPredictions={displayedPredictions.length} />
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  )
}
