# Deployment & Local Development

Full setup instructions for running NeuralProt yourself. See the main [README](README.md) for what the project does and how it performs.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | Frontend | Full URL of the backend API. Set in `.env.local` for local dev, in Vercel dashboard for production. |
| `HF_REPO_ID` | Backend | Hugging Face repository ID where models are stored (e.g. `yourusername/neuralprot-models`). Required when `MODELS_DIR` is not set. |
| `HF_TOKEN` | Backend (optional) | HF access token. Required only for private repositories. |
| `MODELS_DIR` | Backend (optional) | Absolute path to a local models directory. When set, skips the Hugging Face download entirely. Use this for local development. |
| `GO_DICT_PATH` | Backend (optional) | Absolute path to `go_dict.json`. If not set, the backend looks for it inside the models directory. |

---

## Model Files Per Group

Each of the 375 model groups produces four files during training:

| File | Size | Purpose | Push to GitHub? |
|---|---|---|---|
| `{group}_best.pt` | ~4 MB | Best model weights by validation F1. **Required for inference.** | ✅ Yes (via HF) |
| `{group}_terms.json` | ~1 KB | List of GO terms this model predicts. **Required for inference.** | ✅ Yes (via HF) |
| `{group}_log.json` | ~12 KB | Training history, metrics per epoch. Useful for debugging, not needed at runtime. | ⚠️ Optional |
| `{group}_resume.pt` | ~12 MB | Full training checkpoint including optimiser state. Only needed to resume training. | ❌ No |

**Total inference-required storage** (`_best.pt` + `_terms.json` for all 375 groups): approximately **1.5 GB**.

The models folder should **not** be committed directly to GitHub, the combined `_best.pt` size (~1.5 GB) exceeds GitHub's file size limits.

```
GitHub repo  →  source code only (frontend, backend Python files, requirements)
Hugging Face Dataset/Model repo  →  all _best.pt and _terms.json files
```

`.gitignore`:
```gitignore
backend/models/*.pt
backend/models/*.json
!backend/models/model_f1_scores.json   # keep this one; it's tiny and needed locally
backend/models/*_resume.pt
backend/models/*_log.json
```

At runtime on Hugging Face Spaces, the backend downloads all model files automatically via `huggingface_hub.snapshot_download()` on first startup, using `HF_REPO_ID` to know where to look.

---

## Deployment

### Frontend: Vercel

1. Push your repository to GitHub.
2. Import it at [vercel.com](https://vercel.com), setting the root directory to `frontend/`.
3. Add one environment variable in the Vercel dashboard: `VITE_API_URL = https://your-hf-space-name.hf.space`
4. Deploy, Vercel builds automatically on every push to `main`.

Free on Vercel's Hobby plan for personal projects.

### Backend and Models: Hugging Face Spaces

**1. Upload your models to a Hugging Face Dataset repo:**

```bash
pip install huggingface_hub

python3 -c "
from huggingface_hub import HfApi
api = HfApi()
api.create_repo('your-username/neuralprot-models', repo_type='dataset', private=False)
api.upload_folder(
    folder_path='backend/models',
    repo_id='your-username/neuralprot-models',
    repo_type='dataset',
    ignore_patterns=['*_resume.pt', '*_log.json']
)
"
```

**2. Create a Space** at [huggingface.co/new-space](https://huggingface.co/new-space): SDK = Docker, Hardware = CPU Basic (free) or CPU Upgrade (paid, faster cold start).

**3. Add a `Dockerfile`** to your backend folder:

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY neuralprot_backend.py neuralprot_inference.py .
EXPOSE 7860
CMD ["uvicorn", "neuralprot_backend:app", "--host", "0.0.0.0", "--port", "7860"]
```

**4. Set Space secrets:** `HF_REPO_ID = your-username/neuralprot-models`, and `HF_TOKEN` only if the model repo is private.

**5. Update CORS** in `neuralprot_backend.py`:
```python
ALLOWED_ORIGINS = ["https://your-app.vercel.app", "http://localhost:5173"]
```

On first startup the backend downloads ~1.5 GB of model files from Hugging Face, a few minutes on cold start, then cached.

**Free tier limits (CPU Basic):** 2 vCPU / 16 GB RAM (enough to hold all 375 models in memory); the Space sleeps after inactivity, so the first request after sleep triggers a 3–5 minute cold start; no persistent storage, so models re-download each cold start. If that's too slow, use a paid tier with a persistent `/data` volume, or pre-warm the Space by pinging `/health` on a schedule.

---

## Local Development

### Frontend

```bash
git clone https://github.com/your-username/neuralprot-beta.git
cd neuralprot-beta/frontend
npm install
echo "VITE_API_URL=http://127.0.0.1:8000" > .env.local
npm run dev
```

### Backend

```bash
cd neuralprot-beta/backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Option A: local models directory (recommended for dev)
export MODELS_DIR="/absolute/path/to/your/models/folder"
# Option B: download from Hugging Face every startup
export HF_REPO_ID="your-username/neuralprot-models"

uvicorn neuralprot_backend:app --host 127.0.0.1 --port 8000 --reload
```

API available at `http://127.0.0.1:8000`, interactive docs at `/docs`.

**requirements.txt** (minimum):
```
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
torch>=2.2.0
numpy>=1.26.0
pydantic>=2.0.0
huggingface_hub>=0.22.0
python-multipart>=0.0.9
```
