"""Idempotent PDF output, independently testable without a broker."""

from pathlib import Path
from reportlab.pdfgen import canvas


def render_pdf(invoice, customer, amount, directory="/data"):
    destination = Path(directory) / f"{invoice}.pdf"
    if not destination.exists():
        tmp = destination.with_suffix(".tmp")
        pdf = canvas.Canvas(str(tmp))
        pdf.setTitle(f"Failure Lab — {invoice}")
        pdf.setFont("Helvetica-Bold", 24)
        pdf.drawString(60, 770, "FAILURE LAB")
        pdf.setFont("Helvetica", 12)
        for y, text in [
            (725, "SYNTHETIC INVOICE — demonstration only"),
            (670, invoice),
            (640, customer),
            (610, f"Total: ${amount / 100:.2f}"),
            (550, "No payment due. No external delivery performed."),
        ]:
            pdf.drawString(60, y, text)
        pdf.save()
        tmp.replace(destination)
