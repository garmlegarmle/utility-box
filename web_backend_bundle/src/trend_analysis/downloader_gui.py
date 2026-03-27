"""Tkinter GUI for downloading daily OHLCV CSV files from Yahoo Finance."""

from __future__ import annotations

import threading
import tkinter as tk
from datetime import date
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from .downloader import DownloadRequest, DownloadResult, YahooFinanceDownloader


class DownloaderApp:
    """Desktop GUI for single-ticker daily OHLCV downloads."""

    PERIOD_CHOICES = ("1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max")

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.downloader = YahooFinanceDownloader()
        self.is_downloading = False

        self.root.title("Yahoo Finance OHLCV Downloader")
        self.root.geometry("720x500")
        self.root.minsize(680, 460)

        self.ticker_var = tk.StringVar()
        self.period_var = tk.StringVar(value="1y")
        self.start_var = tk.StringVar()
        self.end_var = tk.StringVar()
        self.folder_var = tk.StringVar(value=str(Path.cwd()))
        self.status_var = tk.StringVar(value="Ready. Enter a ticker, choose a folder, and download.")

        self._build_layout()

    def _build_layout(self) -> None:
        container = ttk.Frame(self.root, padding=16)
        container.pack(fill="both", expand=True)
        container.columnconfigure(1, weight=1)

        title = ttk.Label(
            container,
            text="Daily OHLCV Downloader",
            font=("Helvetica", 18, "bold"),
        )
        title.grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 8))

        subtitle = ttk.Label(
            container,
            text="Download daily OHLCV CSV data from Yahoo Finance for one ticker at a time.",
            wraplength=650,
        )
        subtitle.grid(row=1, column=0, columnspan=3, sticky="w", pady=(0, 16))

        ttk.Label(container, text="Ticker").grid(row=2, column=0, sticky="w", pady=6)
        ticker_entry = ttk.Entry(container, textvariable=self.ticker_var)
        ticker_entry.grid(row=2, column=1, sticky="ew", pady=6)
        ticker_entry.focus()

        ttk.Label(container, text="Preset Period").grid(row=3, column=0, sticky="w", pady=6)
        period_box = ttk.Combobox(
            container,
            textvariable=self.period_var,
            values=self.PERIOD_CHOICES,
            state="readonly",
        )
        period_box.grid(row=3, column=1, sticky="ew", pady=6)

        ttk.Label(container, text="Start Date").grid(row=4, column=0, sticky="w", pady=6)
        start_entry = ttk.Entry(container, textvariable=self.start_var)
        start_entry.grid(row=4, column=1, sticky="ew", pady=6)
        ttk.Label(container, text="YYYY-MM-DD, optional").grid(row=4, column=2, sticky="w", padx=(8, 0))

        ttk.Label(container, text="End Date").grid(row=5, column=0, sticky="w", pady=6)
        end_entry = ttk.Entry(container, textvariable=self.end_var)
        end_entry.grid(row=5, column=1, sticky="ew", pady=6)
        ttk.Label(container, text="YYYY-MM-DD, optional").grid(row=5, column=2, sticky="w", padx=(8, 0))

        help_label = ttk.Label(
            container,
            text="If start/end are filled, the app uses those dates. Otherwise it uses the preset period.",
            wraplength=650,
        )
        help_label.grid(row=6, column=0, columnspan=3, sticky="w", pady=(4, 12))

        ttk.Label(container, text="Save Folder").grid(row=7, column=0, sticky="w", pady=6)
        folder_entry = ttk.Entry(container, textvariable=self.folder_var)
        folder_entry.grid(row=7, column=1, sticky="ew", pady=6)
        folder_button = ttk.Button(container, text="Browse", command=self._choose_folder)
        folder_button.grid(row=7, column=2, sticky="ew", padx=(8, 0), pady=6)

        button_row = ttk.Frame(container)
        button_row.grid(row=8, column=0, columnspan=3, sticky="ew", pady=(16, 12))
        button_row.columnconfigure(0, weight=1)
        button_row.columnconfigure(1, weight=1)

        self.download_button = ttk.Button(button_row, text="Download CSV", command=self._start_download)
        self.download_button.grid(row=0, column=0, sticky="ew", padx=(0, 6))

        clear_button = ttk.Button(button_row, text="Clear", command=self._clear_inputs)
        clear_button.grid(row=0, column=1, sticky="ew", padx=(6, 0))

        ttk.Label(container, text="Status").grid(row=9, column=0, sticky="nw", pady=(8, 6))
        status_label = ttk.Label(
            container,
            textvariable=self.status_var,
            wraplength=650,
            foreground="#1f3a5f",
        )
        status_label.grid(row=9, column=1, columnspan=2, sticky="w", pady=(8, 6))

        ttk.Label(container, text="Log").grid(row=10, column=0, sticky="nw", pady=(8, 6))
        self.log_text = tk.Text(container, height=12, wrap="word")
        self.log_text.grid(row=10, column=1, sticky="nsew", pady=(8, 6))
        container.rowconfigure(10, weight=1)

        scroll = ttk.Scrollbar(container, orient="vertical", command=self.log_text.yview)
        scroll.grid(row=10, column=2, sticky="nse")
        self.log_text.configure(yscrollcommand=scroll.set)

    def _choose_folder(self) -> None:
        selected = filedialog.askdirectory(initialdir=self.folder_var.get() or str(Path.cwd()))
        if selected:
            self.folder_var.set(selected)

    def _clear_inputs(self) -> None:
        if self.is_downloading:
            return
        self.ticker_var.set("")
        self.period_var.set("1y")
        self.start_var.set("")
        self.end_var.set("")
        self.status_var.set("Ready. Enter a ticker, choose a folder, and download.")
        self.log_text.delete("1.0", tk.END)

    def _start_download(self) -> None:
        if self.is_downloading:
            return

        try:
            request = self._build_request()
        except ValueError as exc:
            messagebox.showerror("Invalid Input", str(exc))
            return

        self.is_downloading = True
        self.download_button.configure(state="disabled")
        self.status_var.set(f"Downloading {request.normalized_ticker()} daily OHLCV data...")
        self._append_log(f"Starting download for {request.normalized_ticker()}")

        worker = threading.Thread(target=self._download_worker, args=(request,), daemon=True)
        worker.start()

    def _build_request(self) -> DownloadRequest:
        ticker = self.ticker_var.get().strip().upper()
        if not ticker:
            raise ValueError("Please enter a ticker symbol.")

        save_dir = Path(self.folder_var.get().strip()).expanduser()
        if not str(save_dir):
            raise ValueError("Please choose a save folder.")

        start = self.start_var.get().strip() or None
        end = self.end_var.get().strip() or None
        period = self.period_var.get().strip() or "1y"

        for label, value in (("start date", start), ("end date", end)):
            if value is not None:
                self._validate_date(value, label)

        return DownloadRequest(
            ticker=ticker,
            save_dir=save_dir,
            period=period,
            start=start,
            end=end,
            interval="1d",
        )

    def _download_worker(self, request: DownloadRequest) -> None:
        try:
            result = self.downloader.download(request)
        except Exception as exc:  # noqa: BLE001
            self.root.after(0, lambda: self._handle_error(str(exc)))
            return
        self.root.after(0, lambda: self._handle_success(result))

    def _handle_success(self, result: DownloadResult) -> None:
        self.is_downloading = False
        self.download_button.configure(state="normal")
        self.status_var.set(
            f"Downloaded {result.ticker}: {result.rows} rows saved to {result.file_path}"
        )
        self._append_log(f"Saved file: {result.file_path}")
        self._append_log(f"Rows: {result.rows}")
        self._append_log(f"Date range: {result.start_date} -> {result.end_date}")
        messagebox.showinfo("Download Complete", f"{result.ticker} data saved successfully.")

    def _handle_error(self, error_message: str) -> None:
        self.is_downloading = False
        self.download_button.configure(state="normal")
        self.status_var.set("Download failed.")
        self._append_log(f"Error: {error_message}")
        messagebox.showerror("Download Failed", error_message)

    def _append_log(self, message: str) -> None:
        self.log_text.insert(tk.END, f"{message}\n")
        self.log_text.see(tk.END)

    @staticmethod
    def _validate_date(value: str, label: str) -> None:
        try:
            parsed = date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError(f"Invalid {label}. Use YYYY-MM-DD format.") from exc
        if parsed.year < 1900:
            raise ValueError(f"Invalid {label}. Use YYYY-MM-DD format.")


def main() -> None:
    root = tk.Tk()
    ttk.Style().theme_use("clam")
    DownloaderApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
