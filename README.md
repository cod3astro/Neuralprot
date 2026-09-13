# NeuralProt

**A research-grade protein function prediction engine powered by 375 neural network model groups and 498-dimensional biophysical feature vectors.**

NeuralProt takes a raw amino acid sequence and returns a ranked list of Gene Ontology (GO) term predictions, the biological functions the protein is likely to perform. It was built to be scientifically rigorous, practically usable, and fast enough for real research workflows without requiring a GPU.

> **Live demo:** [neuralprot-beta.vercel.app](https://neuralprot-beta.vercel.app)
> **API:** Hosted on Hugging Face Spaces
> **Setup & deployment:** see [DEPLOYMENT.md](DEPLOYMENT.md)

---

## Table of Contents

- [What It Does](#what-it-does)
- [How It Works](#how-it-works)
- [Model Performance](#model-performance)
- [Project Structure](#project-structure)
- [Frontend](#frontend)
- [Backend](#backend)
- [Models](#models)
- [Evaluation](#evaluation)
- [Contributing](#contributing)
- [License](#license)

---

## What It Does 

You paste an amino acid sequence (or upload a FASTA file). NeuralProt:

1. Extracts 498 biophysical features from the sequence
2. Routes those features through up to 375 specialised neural networks
3. Each network votes on whether its GO terms apply to this protein
4. An optional hierarchy gate can propagate confirmed child terms to their parents
5. Returns a ranked, enriched list of GO term predictions with confidence scores

Each prediction carries a GO term ID (linkable to QuickGO/AmiGO), a human-readable function name, a namespace badge (Biological Process, Molecular Function, or Cellular Component), and an animated confidence bar.

---

## How It Works

**1. Feature Extraction (498 dimensions).** Every sequence becomes a fixed-length numerical vector before any model sees it, 20 amino acid composition features, 400 dipeptide frequencies (20×20 pairs), and 78 physicochemical properties (molecular weight, hydrophobicity, isoelectric point, charge distribution, secondary structure propensities, and more). CPU-friendly, deterministic, no external lookups at inference time.

**2. Model Group Routing.** Rather than one massive model, NeuralProt uses **Dynamic Tree Splitting** to group the 38,560+ GO terms into 375 biologically coherent clusters based on annotation co-occurrence (e.g. one group covers kinase-related molecular functions, another covers ion channel activity). Routing is implicit: the feature vector is passed to every loaded group in parallel, and each independently decides whether its terms apply.

**3. Neural Network Voting.** Each group is a multilayer perceptron (MLP) that outputs a probability per GO term in its group. Terms whose probability exceeds the group's tuned threshold are included. Thresholds were tuned per group on a held-out validation set by sweeping 100 candidate values (0.05–0.95) to maximise macro F1.

**4. Hierarchy Safety Gate (optional).** The Gene Ontology is a directed acyclic graph, a protein predicted to do a specific child function (e.g. "protein serine/threonine kinase activity") is biologically required to also do its parent functions ("kinase activity", "transferase activity"). `predict_single()` supports enforcing this via an opt-in `apply_parent_gate` flag: any child term at ≥75% confidence propagates upward to its ancestors, labelled "Hierarchy Tree Rule" with a fixed 1.0000 confidence score. **This flag defaults to off, and neither `/predict/sequence` nor `/predict/fasta` currently enables it** as shipped, only direct neural-network predictions are returned.

**5. Result Delivery.** Results are sorted by GO term specificity (ontology depth) then confidence. The API response includes GO names, namespaces, confidence scores, prediction source, and the count of model groups that participated.

---

## Model Performance

Evaluated with CAFA-standard metrics on a held-out test set the model never saw during training or threshold tuning. Two metrics are reported because they answer different questions:

- **Per-group F1 at deployed threshold** > one tuned threshold per group, applied to all its terms at once. This is what the live app serves.
- **Per-term Fmax** > the CAFA-standard metric: each individual GO term gets its own best-possible threshold. This is what's comparable to published CAFA results.

| Metric | Value |
|---|---|
| Total model groups | 375 (100% trained successfully) |
| GO terms covered | 38,560+ |
| Individual GO-term labels evaluated on the test set | 10,821 |
| **Average per-group F1 (deployed threshold)** | **0.61** |
| Best single group F1 (deployed) | 0.9084 (purine nucleotide metabolic process, GO:0006163) |
| Groups with deployed F1 ≥ 0.70 / ≥ 0.50 / ≥ 0.30 | 99 / 304 / 371 |
| **Average per-term Fmax (CAFA-standard)** | **0.76** |
| Average per-term Fmax, well-supported terms (≥100 test proteins, n=291) | 0.90 |
| Per-term distribution (of 10,821 labels) | 6,441 strong (≥0.70) · 2,140 moderate (0.50–0.69) · 1,242 weak · 0 unlearnable |

> One term (`positive_regulation_of_DNA-templated_transcription`, GO:0045893) reached a perfect 1.0000 Fmax on 480 test proteins, worth a sanity check before citing, since a perfect score at that sample size is unusual and could reflect how that term's group was constructed rather than genuine separability.

The three prediction presets reflect the deployed per-group F1 tiers:

| Preset | F1 Threshold | Groups Active | Use Case |
|---|---|---|---|
| Broad | ≥ 0.30 | 371 | Exploratory research, novel proteins |
| Balanced | ≥ 0.50 | 304 | General-purpose annotation |
| Strict | ≥ 0.70 | 99 | Publication-grade annotation of well-studied families |

---

## Project Structure

```
neuralprot-beta/
├── frontend/                    # React + Vite application
│   ├── src/
│   │   ├── pages/                # Predict, Compare, Evaluate, Docs, About
│   │   ├── components/           # prediction/ and layout/
│   │   ├── hooks/usePrediction.js
│   │   └── utils/
│   ├── .env.local               # VITE_API_URL=http://127.0.0.1:8000
│   └── package.json
│
├── backend/
│   ├── neuralprot_backend.py    # FastAPI application
│   ├── neuralprot_inference.py  # Feature extraction + model registry
│   ├── requirements.txt
│   └── models/
│       ├── model_f1_scores.json
│       ├── go_dict.json
│       ├── {group_name}_best.pt
│       └── {group_name}_terms.json
│
├── DEPLOYMENT.md
└── README.md
```

---

## Frontend

**Tech stack:** React 18, Vite 5, Tailwind CSS 3, Motion (Framer Motion), Recharts, Lucide React, React Router v6. Dark/light mode via Tailwind's `class` strategy, persisted to `localStorage`. All API calls use `import.meta.env.VITE_API_URL`, never a hardcoded IP.

**Pages:**
- **Predict**: single-sequence or batch-FASTA prediction, with an animated loading narrator and results split into Neural Network AI vs. Hierarchy Tree Rule panels
- **Compare**: side-by-side prediction for two proteins, shared and unique functions highlighted
- **Evaluate**: Fmax/Smin evaluation desk against a flat frequency baseline
- **Docs**: interactive documentation of the architecture
- **About**: project history and links to CAFA, GO Consortium, UniProt

**Model Quality Filter:** a three-way preset sent to the backend as `f1_threshold`. All 375 models stay loaded in memory; switching presets costs nothing.
```
Broad    (F1 ≥ 0.30); 371 models; Maximum coverage
Balanced (F1 ≥ 0.50); 304 models; General purpose
Strict   (F1 ≥ 0.70);  99 models; Highest confidence
```

---

## Backend

**Tech stack:** FastAPI, PyTorch, huggingface_hub, Pydantic, Uvicorn.

**Endpoints:**

| Endpoint | Purpose |
|---|---|
| `GET /health` | Server status and count of loaded model groups |
| `POST /predict/sequence` | Predict GO terms for one sequence - body: `sequence`, `f1_threshold`, `top_n`, `min_confidence` |
| `POST /predict/fasta` | Batch prediction from a `.fasta`/`.fa` upload, same filter controls as above |
| `POST /fmax` | CAFA-standard Fmax/Smin evaluation from three uploaded files (train TSV, test FASTA, test TSV) |
| `POST /evaluate` | Per-term F1 evaluation on an annotated test set |
| `GET /go_dict` | Full GO term dictionary (38,560+ terms, names, namespaces, ancestors) |

Example `/predict/sequence` response:
```json
{
  "n_predictions": 47,
  "modelsUsed": 304,
  "f1_threshold": 0.5,
  "predictions": [
    {
      "go_term": "GO:0004672",
      "go_name": "protein kinase activity",
      "namespace": "molecular_function",
      "confidence": 0.8913,
      "threshold": 0.87,
      "predicted_by": "Neural Network AI",
      "group": "protein_kinase_activity_GO_0004672"
    }
  ]
}
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for environment variables and setup.

---

## Models

Every group uses the same `NeuralProtMLP`: 498-neuron input layer, two hidden layers (batch norm, dropout, ReLU), and one sigmoid output neuron per GO term in that group (multi-label classification).

Trained with **nn.BCEWithLogitsLoss(pos_weight=...)** to handle the severe class imbalance in GO annotation data, most terms are positive for only a small fraction of proteins, and pos_weight down-weights easy negatives in favor of the hard, informative cases. Thresholds were tuned per group by sweeping 100 values (0.05–0.95) on a held-out validation set and are stored in each group's metadata.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the per-group file layout and what to push where.

---

## Evaluation

**Fmax**: the maximum F-measure across all decision thresholds (harmonic mean of precision and recall). Higher is better, max 1.0. Averaged per-term across 10,821 evaluated GO-term labels, NeuralProt achieves a mean Fmax of **0.76** (**0.90** for the 291 terms with ≥100 held-out test proteins).

**Smin**: minimum semantic distance between predicted and true annotations, weighted by each GO term's Information Content. Lower is better, min 0.0.

Run an evaluation via the Evaluate page by uploading `train_annotations.tsv` (frequency baseline), `test_proteins.fasta`, and `test_annotations.tsv` (ground truth). The interface reports Fmax and Smin against a flat frequency baseline, with percentage improvement.

---

## Contributing

Pull requests are welcome, for significant changes, open an issue first.

When touching the model or inference code, please ensure:
- `get_group_probs()` stays filter-free (the evaluator needs every group to run)
- `predict_single()` keeps accepting and respecting `min_f1`
- `_load_whitelist()` loads all groups at startup (filtering happens at runtime, not load time)
- No F1 scores are hardcoded in the inference file, `model_f1_scores.json` is the single source of truth

---

## License

MIT License; see `LICENSE`. Gene Ontology data provided by the [Gene Ontology Consortium](http://geneontology.org/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

---

*Built for the research community.*
