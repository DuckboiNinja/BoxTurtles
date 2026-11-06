from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import JSON, Float, ForeignKey, Integer, String, Text, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker


def uid() -> str:
    return str(uuid4())


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Base(DeclarativeBase):
    pass


class CapturedImage(Base):
    __tablename__ = "captured_images"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    original_image_path: Mapped[str] = mapped_column(String)
    filename: Mapped[str] = mapped_column(String)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    captured_at: Mapped[str | None] = mapped_column(String, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    uploaded_at: Mapped[str] = mapped_column(String, default=now)
    source: Mapped[str] = mapped_column(String)
    is_demo: Mapped[bool] = mapped_column(default=False)
    metadata_info: Mapped[dict] = mapped_column(JSON, default=dict)
    detections: Mapped[list["Detection"]] = relationship(back_populates="image")


class Detection(Base):
    __tablename__ = "detections"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    image_id: Mapped[str] = mapped_column(ForeignKey("captured_images.id"), index=True)
    class_name: Mapped[str] = mapped_column(String)
    confidence: Mapped[float] = mapped_column(Float)
    bounding_box: Mapped[list] = mapped_column(JSON)
    cropped_image_path: Mapped[str] = mapped_column(String)
    annotated_image_path: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="pending", index=True)
    reviewed_at: Mapped[str | None] = mapped_column(String, nullable=True)
    review_method: Mapped[str | None] = mapped_column(String, nullable=True)
    auto_accept_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    model_id: Mapped[str] = mapped_column(String)
    model_name: Mapped[str] = mapped_column(String)
    is_mock: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[str] = mapped_column(String, default=now, index=True)
    image: Mapped[CapturedImage] = relationship(back_populates="detections")


class DetectionModel(Base):
    __tablename__ = "detection_models"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String)
    path: Mapped[str] = mapped_column(String)
    # Empty labels explicitly means accept all labels, useful for single-class custom models.
    labels: Mapped[list] = mapped_column(JSON, default=lambda: ["turtle"])
    created_at: Mapped[str] = mapped_column(String, default=now)


class RuntimeSettings(Base):
    __tablename__ = "runtime_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    active_model_id: Mapped[str] = mapped_column(String, default="demo")
    confidence_threshold: Mapped[float] = mapped_column(Float, default=0.5)
    frame_interval_seconds: Mapped[float] = mapped_column(Float, default=3.0)
    max_frames: Mapped[int] = mapped_column(Integer, default=60)
    auto_accept_enabled: Mapped[bool] = mapped_column(default=False)
    auto_accept_threshold: Mapped[float] = mapped_column(Float, default=0.95)


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    filename: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="queued")
    processed_frames: Mapped[int] = mapped_column(Integer, default=0)
    total_frames: Mapped[int] = mapped_column(Integer, default=0)
    detections_created: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    settings_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[str] = mapped_column(String, default=now)
    finished_at: Mapped[str | None] = mapped_column(String, nullable=True)


def connect(storage):
    storage.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{(storage / 'turtles.sqlite3').as_posix()}", connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(engine, "connect")
    def pragmas(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")

    Base.metadata.create_all(engine)
    # create_all preserves existing tables. Add new nullable audit fields and
    # conservative settings without rewriting any prior records or reviews.
    additions = {
        "runtime_settings": {
            "auto_accept_enabled": "BOOLEAN NOT NULL DEFAULT 0",
            "auto_accept_threshold": "FLOAT NOT NULL DEFAULT 0.95",
        },
        "detections": {
            "review_method": "VARCHAR",
            "auto_accept_threshold": "FLOAT",
        },
    }
    with engine.connect() as connection:
        # Serialize startup migrations from multiple local server processes.
        connection.exec_driver_sql("BEGIN IMMEDIATE")
        for table, columns in additions.items():
            present = {row[1] for row in connection.exec_driver_sql(f'PRAGMA table_info("{table}")')}
            for column, declaration in columns.items():
                if column not in present:
                    connection.exec_driver_sql(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {declaration}')
        connection.commit()
    return engine, sessionmaker(engine, expire_on_commit=False)
