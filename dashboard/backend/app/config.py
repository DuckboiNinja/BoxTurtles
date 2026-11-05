from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TURTLE_", env_file=ROOT / ".env", extra="ignore")
    data_dir: Path = ROOT / "data"
    seed_demo: bool = True
    max_upload_mb: int = 1024
    telemetry_tolerance_seconds: float = 2.0
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    ingest_token: str | None = None

    @property
    def storage(self) -> Path:
        path = self.data_dir if self.data_dir.is_absolute() else ROOT / self.data_dir
        return path.resolve()
