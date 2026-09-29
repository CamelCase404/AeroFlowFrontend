import io
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image


class SpectralConv2d(nn.Module):
    def __init__(self, in_ch, out_ch, modes):
        super().__init__()
        self.modes = modes
        scale = 1 / (in_ch * out_ch)
        self.w1 = nn.Parameter(
            scale * torch.rand(in_ch, out_ch, modes, modes, dtype=torch.cfloat)
        )
        self.w2 = nn.Parameter(
            scale * torch.rand(in_ch, out_ch, modes, modes, dtype=torch.cfloat)
        )

    def forward(self, x):
        b = x.shape[0]
        x_ft = torch.fft.rfft2(x)
        out_ft = torch.zeros(
            b,
            x.shape[1],
            x.shape[-2],
            x.shape[-1] // 2 + 1,
            dtype=torch.cfloat,
            device=x.device,
        )
        out_ft[:, :, : self.modes, : self.modes] = torch.einsum(
            "bixy,ioxy->boxy",
            x_ft[:, :, : self.modes, : self.modes],
            self.w1,
        )
        out_ft[:, :, -self.modes :, : self.modes] = torch.einsum(
            "bixy,ioxy->boxy",
            x_ft[:, :, -self.modes :, : self.modes],
            self.w2,
        )
        return torch.fft.irfft2(out_ft, s=(x.shape[-2], x.shape[-1]))


class FNO(nn.Module):
    def __init__(self, in_ch=3, out_ch=3, hidden=32, modes=12):
        super().__init__()
        self.fc0 = nn.Conv2d(in_ch, hidden, 1)
        self.spec = SpectralConv2d(hidden, hidden, modes)
        self.pw = nn.Conv2d(hidden, hidden, 1)
        self.fc1 = nn.Conv2d(hidden, 64, 1)
        self.fc2 = nn.Conv2d(64, out_ch, 1)

    def forward(self, x):
        x = self.fc0(x)
        x = F.gelu(self.spec(x) + self.pw(x)) + x
        x = F.gelu(self.fc1(x))
        return self.fc2(x)


device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = FNO().to(device)
model.eval()

app = FastAPI(title="AeroFlow API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def to_mask(data: bytes, res: int) -> np.ndarray:
    img = Image.open(io.BytesIO(data)).convert("L")
    img = img.resize((res, res), Image.BILINEAR)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    return np.clip(1.0 - arr, 0.0, 1.0)


def to_tensor(mask: np.ndarray, speed: float, density: float) -> torch.Tensor:
    res = mask.shape[0]
    u0 = np.full((res, res), speed / 10.0, dtype=np.float32)
    v0 = np.zeros((res, res), dtype=np.float32)
    geom = np.where(mask > 0.5, 1.0, 0.0).astype(np.float32)
    tensor = np.stack([geom, u0, v0], axis=0)
    return torch.from_numpy(tensor).unsqueeze(0)


def downsample(arr: np.ndarray, size: int = 64) -> list:
    if arr.shape[0] > size:
        step = arr.shape[0] // size
        arr = arr[::step, ::step][:size, :size]
    return np.round(arr.astype(np.float32), 4).tolist()


@app.get("/health")
def health():
    return {"status": "ok", "device": str(device)}


@app.post("/api/simulate")
async def simulate(
    file: UploadFile = File(...),
    speed: float = Form(6.0),
    density: float = Form(160.0),
    resolution: int = Form(128),
):
    if resolution not in (64, 128, 256):
        raise HTTPException(400, "resolution must be 64, 128 or 256")

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "empty file")

    started = time.perf_counter()

    mask = to_mask(raw, resolution)
    tensor = to_tensor(mask, speed, density).to(device)

    with torch.inference_mode():
        output = model(tensor)

    arr = output.squeeze(0).cpu().numpy()
    pressure = arr[0]
    velocity_u = arr[1]
    velocity_v = arr[2]

    pressure = (pressure - pressure.min()) / max(pressure.ptp(), 1e-6)
    velocity_u = (velocity_u - velocity_u.min()) / max(velocity_u.ptp(), 1e-6)
    velocity_v = (velocity_v - velocity_v.min()) / max(velocity_v.ptp(), 1e-6)

    cx = round(float(0.02 + (pressure.max() - pressure.min()) * 0.5), 4)
    cy = round(
        float(
            max(
                0.0,
                mask[:, : resolution // 4].mean() - mask[:, -resolution // 4 :].mean(),
            )
        ),
        4,
    )

    return {
        "pressure": downsample(pressure),
        "velocity_u": downsample(velocity_u),
        "velocity_v": downsample(velocity_v),
        "stats": {
            "cx": cx,
            "cy": cy,
            "reynolds": round(density * speed * resolution / 1.8e-5, 1),
        },
        "resolution": resolution,
        "inference_ms": round((time.perf_counter() - started) * 1000, 2),
    }
