"""Preserve and normalize actual JACDASH sales-report workbooks."""

from __future__ import annotations

import base64
import hashlib
import io
import math
import re
import unicodedata
from collections import OrderedDict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

import openpyxl
from openpyxl.utils.datetime import from_excel

MAX_ROWS = 50_000
MAX_TRANSACTIONS = 25_000


def normalize(value: object) -> str:
    # Some source exports contain replacement characters where an em dash
    # should be. Treat Unicode punctuation/symbols as word boundaries before
    # dropping non-ASCII marks, otherwise "Review�excluded" collapses to
    # "reviewexcluded" and silently misses its recognized status.
    raw = "".join(" " if unicodedata.category(char)[0] in {"P", "S"} else char for char in str(value or ""))
    text = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def safe_value(value: object) -> object:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def cell_text(cell) -> str | None:
    if cell is None:
        return None
    value = cell.value
    if value is None:
        return None
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int):
        text = str(value)
        fmt = str(getattr(cell, "number_format", ""))
        if re.fullmatch(r"0+", fmt):
            text = text.zfill(len(fmt))
        return text
    if isinstance(value, float):
        if not math.isfinite(value):
            return str(value)
        text = str(int(value)) if value.is_integer() else str(value)
        fmt = str(getattr(cell, "number_format", ""))
        if value.is_integer() and re.fullmatch(r"0+", fmt):
            text = text.zfill(len(fmt))
        return text
    return str(value).strip() or None


def parse_date(cell, epoch) -> date | None:
    value = cell.value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            parsed = from_excel(value, epoch)
            return parsed.date() if isinstance(parsed, datetime) else parsed if isinstance(parsed, date) else None
        except (ValueError, TypeError, OverflowError):
            return None
    if isinstance(value, str):
        raw = value.strip()
        for fmt in ("%Y-%m-%d", "%Y-%m", "%m/%d/%Y", "%d/%m/%Y", "%b %d, %Y", "%B %d, %Y"):
            try:
                return datetime.strptime(raw, fmt).date()
            except ValueError:
                continue
    return None


def parse_amount(value: object) -> Decimal | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    raw = str(value).strip().replace(",", "").replace("₱", "").replace("PHP", "").strip()
    try:
        amount = Decimal(raw)
    except (InvalidOperation, ValueError):
        return None
    if not amount.is_finite() or amount < 0:
        return None
    return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def canonical_document(value: str | None, kind: str) -> str:
    if not value:
        return ""
    cleaned = normalize(value)
    cleaned = re.sub(rf"^{kind}\s*(number|no)?\s*", "", cleaned)
    return re.sub(r"[^a-z0-9]", "", cleaned)


def field_for_header(header: object) -> str | None:
    value = normalize(header)
    if value == "date":
        return "date"
    if value in {"account name", "client name", "customer name", "sold to", "delivered to", "received from"}:
        return "client"
    if value in {"po", "po no", "purchase order", "purchase order no", "po number"}:
        return "po"
    if value in {"si", "si no", "sales invoice", "sales invoice no", "invoice no"}:
        return "si"
    if value in {"dr", "dr no", "delivery receipt", "delivery receipt no"}:
        return "dr"
    if value in {"customer type", "customer category", "account type", "type"}:
        return "customer_type"
    if value in {"details", "products", "product", "medicine", "medicine name", "product name", "description", "item", "item name"}:
        return "product"
    if value == "remarks":
        return "remarks"
    if "amount" in value and not any(token in value for token in ("unit price", "unit amount", "upric", "u p")):
        return "amount"
    return None


def amount_type(header: object) -> str | None:
    value = normalize(header)
    if "government" in value or re.search(r"\bgov\b", value):
        return "government"
    if "private" in value:
        return "private"
    return None


def section_kind(rows, header_row: int, start_col: int, end_col: int) -> str:
    for row_index in range(header_row - 1, max(-1, header_row - 8), -1):
        text = " ".join(normalize(cell.value) for cell in rows[row_index][start_col:end_col + 1] if cell.value is not None)
        if not text:
            continue
        if "collection receipt" in text:
            return "collection_receipt"
        if "delivery receipt" in text:
            return "delivery_receipt"
        if "sales invoice" in text:
            return "sales_invoice"
        if "sales report" in text:
            return "sales_report"
    return "unknown"


def find_tables(sheet) -> list[dict]:
    rows = list(sheet.iter_rows())
    tables = []
    for row_index, row in enumerate(rows):
        headers = [field_for_header(cell.value) for cell in row]
        starts = [index for index, field in enumerate(headers) if field == "date"]
        for segment_index, start in enumerate(starts):
            end = starts[segment_index + 1] - 1 if segment_index + 1 < len(starts) else len(row) - 1
            segment = headers[start:end + 1]
            if "amount" not in segment or not ("client" in segment):
                continue
            kind = section_kind(rows, row_index, start, end)
            if kind in {"collection_receipt", "delivery_receipt"}:
                continue
            # A delivery table can lack a visible title; never treat it as a sale.
            if any(normalize(row[start + offset].value) == "delivered to" for offset, field in enumerate(segment) if field == "client"):
                continue
            tables.append({"rows": rows, "header_row": row_index, "start": start, "end": end, "fields": headers, "kind": kind})
    return tables


def preview_excel(excel_base64: str) -> dict:
    try:
        content = base64.b64decode(excel_base64, validate=True)
    except Exception as exc:
        raise ValueError("The workbook could not be decoded.") from exc
    try:
        workbook = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        raise ValueError("Choose a valid .xlsx workbook.") from exc

    source_headers: dict[str, list] = {}
    source_records: list[dict] = []
    transactions: OrderedDict[str, dict] = OrderedDict()
    errors: list[dict] = []
    seen_lines: set[str] = set()
    duplicate_rows = 0
    scanned_rows = 0
    valid_source_rows: set[tuple[str, int]] = set()

    for sheet in workbook.worksheets:
        tables = find_tables(sheet)
        rows = tables[0]["rows"] if tables else list(sheet.iter_rows())
        header_positions = {(table["header_row"], table["start"], table["end"]): table for table in tables}
        for table in tables:
            header = rows[table["header_row"]][table["start"]:table["end"] + 1]
            source_headers.setdefault(sheet.title, []).append([safe_value(cell.value) for cell in header])
        for row_index, row in enumerate(rows):
            values = [safe_value(cell.value) for cell in row]
            if not any(value is not None and value != "" for value in values):
                continue
            scanned_rows += 1
            if scanned_rows > MAX_ROWS:
                workbook.close()
                raise ValueError(f"The workbook exceeds the {MAX_ROWS:,} non-empty row limit.")
            source_records.append({"sheet": sheet.title, "row": row_index + 1, "values": values})
        for table in tables:
            header_index, start, end = table["header_row"], table["start"], table["end"]
            fields = table["fields"]
            headers = rows[header_index]
            indexes: dict[str, list[int]] = {}
            for col in range(start, end + 1):
                field = fields[col]
                if field:
                    indexes.setdefault(field, []).append(col)
            amount_columns = indexes.get("amount", [])
            split_columns = {col: amount_type(headers[col].value) for col in amount_columns}
            has_split = len(amount_columns) > 1 and any(value for value in split_columns.values())
            previous_context: dict | None = None
            for row_index in range(header_index + 1, len(rows)):
                row = rows[row_index]
                if (row_index, start, end) in header_positions:
                    break
                row_values = [cell.value for cell in row[start:end + 1]]
                if not any(value is not None and str(value).strip() for value in row_values):
                    continue
                get_cell = lambda key: row[indexes[key][0]] if indexes.get(key) else None
                date_cell = get_cell("date")
                po = cell_text(get_cell("po"))
                si = cell_text(get_cell("si"))
                dr = cell_text(get_cell("dr"))
                client_cell = get_cell("client")
                client = cell_text(client_cell)
                explicit_docs = (canonical_document(si, "si"), canonical_document(po, "po"), canonical_document(dr, "dr"))
                current_date = parse_date(date_cell, workbook.epoch) if date_cell else None
                inherited_date_row = None
                same_document = bool(previous_context and any(
                    value and previous_context["canonical_docs"][position] == value
                    for position, value in enumerate(explicit_docs)
                ) and all(
                    not value or not previous_context["canonical_docs"][position] or previous_context["canonical_docs"][position] == value
                    for position, value in enumerate(explicit_docs)
                ))
                if same_document:
                    if current_date is None:
                        current_date = previous_context["date"]
                    if client is None:
                        client = previous_context["client"]
                    if po is None: po = previous_context["po"]
                    if si is None: si = previous_context["si"]
                    if dr is None: dr = previous_context["dr"]
                    inherited_date_row = previous_context["row"]
                elif current_date is not None or any((po, si, dr)):
                    previous_context = {"date": current_date, "client": client, "po": po, "si": si, "dr": dr, "canonical_docs": explicit_docs, "row": row_index + 1}

                product_cell = get_cell("product")
                if product_cell is None or product_cell.value is None or not str(product_cell.value).strip():
                    product_cell = get_cell("remarks")
                product = cell_text(product_cell)
                type_cell = get_cell("customer_type")
                explicit_type = normalize(type_cell.value) if type_cell else ""
                customer_type = "government" if explicit_type in {"government", "gov", "public"} else "private" if explicit_type == "private" else None
                amount_parts = []
                for col in amount_columns:
                    raw_amount = row[col].value
                    if raw_amount is None or (isinstance(raw_amount, str) and not raw_amount.strip()):
                        continue
                    amount = parse_amount(raw_amount)
                    if amount is None:
                        errors.append({"sheet": sheet.title, "row": row_index + 1, "messages": ["Sales Amount must be a valid nonnegative PHP amount."]})
                        continue
                    row_type = split_columns.get(col) or customer_type
                    amount_parts.append((amount, row_type))
                if amount_parts and current_date is None:
                    errors.append({"sheet": sheet.title, "row": row_index + 1, "messages": ["Date is missing or invalid; no current date was substituted."]})
                    continue
                if not amount_parts:
                    # Item-only continuation lines are attached only when they carry
                    # a document number that unambiguously matches the current group.
                    if product and current_date and any((po, si, dr)):
                        line_amounts = [(None, customer_type)]
                    else:
                        continue
                else:
                    line_amounts = amount_parts

                for amount, row_type in line_amounts:
                    date_text = current_date.isoformat() if current_date else None
                    doc_key = (canonical_document(si, "si"), canonical_document(po, "po"), canonical_document(dr, "dr"))
                    if any(doc_key):
                        group_key = "|".join((date_text or "", normalize(client), row_type or "", *doc_key))
                    else:
                        group_key = f"{sheet.title}|{row_index + 1}|{row_type or ''}"
                    signature = "|".join((date_text or "", normalize(client), row_type or "", *doc_key, f"{amount:.2f}" if amount is not None else "", normalize(product)))
                    fingerprint = hashlib.sha256(signature.encode("utf-8")).hexdigest()
                    if fingerprint in seen_lines:
                        duplicate_rows += 1
                        continue
                    seen_lines.add(fingerprint)
                    if group_key not in transactions:
                        if amount is None:
                            errors.append({"sheet": sheet.title, "row": row_index + 1, "messages": ["Sales Amount is missing for this transaction line; the row is retained in the source workbook but not counted as zero sales."]})
                            continue
                        transactions[group_key] = {
                            "transactionDate": date_text,
                            "productDescriptions": [],
                            "clientName": client,
                            "customerType": row_type,
                            "poNumber": po,
                            "siNumber": si,
                            "drNumber": dr,
                            "salesAmount": Decimal("0.00"),
                            "sourceSheet": sheet.title,
                            "sourceRows": [],
                            "sourceRecords": [],
                            "lineFingerprints": [],
                            "hasAmount": False,
                        }
                    transaction = transactions[group_key]
                    if amount is not None:
                        transaction["salesAmount"] += amount
                        transaction["hasAmount"] = True
                    if product and product not in transaction["productDescriptions"]:
                        transaction["productDescriptions"].append(product)
                    source_record = {"sheet": sheet.title, "row": row_index + 1, "values": [safe_value(cell.value) for cell in row]}
                    if source_record not in transaction["sourceRecords"]:
                        transaction["sourceRows"].append(row_index + 1)
                        transaction["sourceRecords"].append(source_record)
                    transaction["lineFingerprints"].append(fingerprint)
                    valid_source_rows.add((sheet.title, row_index + 1))
                    if len(transactions) > MAX_TRANSACTIONS:
                        workbook.close()
                        raise ValueError(f"The workbook exceeds the {MAX_TRANSACTIONS:,} grouped transaction limit.")

    workbook.close()
    normalized = []
    for transaction in transactions.values():
        if not transaction.pop("hasAmount", False):
            continue
        transaction["salesAmount"] = float(transaction["salesAmount"].quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
        fingerprint_source = {
            "transactionDate": transaction["transactionDate"],
            "clientName": normalize(transaction["clientName"]),
            "customerType": transaction["customerType"],
            "poNumber": canonical_document(transaction["poNumber"], "po"),
            "siNumber": canonical_document(transaction["siNumber"], "si"),
            "drNumber": canonical_document(transaction["drNumber"], "dr"),
            "salesAmount": f"{transaction['salesAmount']:.2f}",
            "productDescriptions": [normalize(product) for product in transaction["productDescriptions"]],
        }
        transaction["recordFingerprint"] = hashlib.sha256(repr(fingerprint_source).encode("utf-8")).hexdigest()
        del transaction["lineFingerprints"]
        normalized.append(transaction)

    invalid_count = len(errors)
    months = sorted({row["transactionDate"][:7] for row in normalized if row["transactionDate"]})
    missing_months = []
    if months:
        start = datetime.strptime(months[0], "%Y-%m").date()
        end = datetime.strptime(months[-1], "%Y-%m").date()
        cursor, final = start.year * 12 + start.month - 1, end.year * 12 + end.month - 1
        present = set(months)
        while cursor <= final:
            year, month0 = divmod(cursor, 12)
            label = f"{year:04d}-{month0 + 1:02d}"
            if label not in present:
                missing_months.append(label)
            cursor += 1
    forecast_records = [{
        "date": row["transactionDate"], "salesAmount": row["salesAmount"],
        "invoiceReference": row["siNumber"] or row["poNumber"] or row["drNumber"],
        "customer": row["clientName"], "productDescription": "; ".join(row["productDescriptions"]) or None,
        "customerType": row["customerType"], "sourceSheet": row["sourceSheet"],
        "sourceRows": row["sourceRows"], "sourceRow": row["sourceRows"][0] if row["sourceRows"] else None,
    } for row in normalized]
    return {
        "transactions": normalized,
        "records": forecast_records,
        "rawRowCount": len(source_records),
        "validRows": len(normalized),
        "invalidRows": invalid_count,
        "duplicateRows": duplicate_rows,
        "errors": errors[:100],
        "errorsTruncated": invalid_count > 100,
        "sourceHeaders": source_headers,
        "sourceRecords": source_records,
        "historicalStartDate": min((row["transactionDate"] for row in normalized if row["transactionDate"]), default=None),
        "historicalEndDate": max((row["transactionDate"] for row in normalized if row["transactionDate"]), default=None),
        "observedMonths": len(months),
        "missingMonths": missing_months,
        "preview": normalized[:50],
    }


def preview_cleaned_workbook(excel_base64: str) -> dict:
    """Validate the supplied cleaned workbook and reconcile its monthly sheet.

    Only Clean Sales Records creates transaction rows. Monthly Revenue supplies
    the forecast series after its totals and counts are checked against included
    transaction rows. Reference and review sheets are retained as source audit
    material and never become sales transactions.
    """
    try:
        content = base64.b64decode(excel_base64, validate=True)
    except Exception as exc:
        raise ValueError("The workbook could not be decoded.") from exc
    try:
        workbook = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        raise ValueError("Choose a valid .xlsx workbook.") from exc

    required = {"Clean Sales Records", "Monthly Revenue"}
    missing_sheets = sorted(required - set(workbook.sheetnames))
    if missing_sheets:
        workbook.close()
        raise ValueError("The cleaned workbook must contain Clean Sales Records and Monthly Revenue sheets.")

    source_headers: dict[str, list] = {}
    source_records: list[dict] = []
    row_count_by_sheet: dict[str, int] = {}
    for sheet in workbook.worksheets:
        iterator = sheet.iter_rows(values_only=True)
        header = next(iterator, None)
        source_headers[sheet.title] = [safe_value(value) for value in (header or [])]
        count = 0
        if header:
            for row_number, row in enumerate(iterator, start=2):
                if not any(value is not None and str(value).strip() for value in row):
                    continue
                count += 1
                source_records.append({"sheet": sheet.title, "row": row_number, "values": [safe_value(value) for value in row]})
        row_count_by_sheet[sheet.title] = count

    def header_indexes(sheet_name: str) -> tuple[list, dict[str, int]]:
        headers = source_headers[sheet_name]
        normalized = [normalize(value) for value in headers]
        aliases = {
            "date": {"date", "transaction date"},
            "client": {"client name", "customer name", "account name"},
            "product": {"medicine product remarks", "medicine product", "product name", "medicine name"},
            "customer_type": {"customer type", "customer category"},
            "po": {"po", "po no", "po number", "purchase order"},
            "si": {"si", "si no", "si number", "sales invoice"},
            "dr": {"dr", "dr no", "dr number", "delivery receipt"},
            "government_amount": {"government amount php", "government amount"},
            "private_amount": {"private amount php", "private amount"},
            "sales_amount": {"sales amount php", "sales amount", "recorded revenue php"},
            "quantity": {"quantity if available", "quantity"},
            "unit": {"unit"},
            "unit_price": {"unit price php", "unit price"},
            "document_type": {"document type"},
            "source_file": {"source file"},
            "source_sheet": {"source sheet"},
            "source_row": {"source row"},
            "import_status": {"import status"},
            "quality_notes": {"data quality notes", "notes"},
        }
        indexes = {key: next((i for i, value in enumerate(normalized) if value in choices), -1) for key, choices in aliases.items()}
        return normalized, indexes

    _, sales_indexes = header_indexes("Clean Sales Records")
    required_fields = ("date", "client", "product", "customer_type", "po", "si", "dr", "sales_amount", "import_status")
    if any(sales_indexes.get(key, -1) < 0 for key in required_fields):
        workbook.close()
        raise ValueError("Clean Sales Records is missing one or more required transaction columns.")

    clean_rows = list(workbook["Clean Sales Records"].iter_rows(values_only=True))[1:]
    transactions: list[dict] = []
    errors: list[dict] = []
    flagged_review_rows: list[dict] = []
    duplicate_rows = 0
    status_counts: dict[str, int] = {}
    exact_fingerprints: set[str] = set()
    computed_monthly: dict[str, Decimal] = {}
    computed_counts: dict[str, int] = {}
    imported_statuses = {"included", "review excluded"}
    max_clean_row = row_count_by_sheet.get("Clean Sales Records", 0) + 1

    def get(row, key):
        index = sales_indexes.get(key, -1)
        return row[index] if index >= 0 and index < len(row) else None

    for row_number, row in enumerate(clean_rows, start=2):
        if not any(value is not None and str(value).strip() for value in row):
            continue
        raw_status = str(get(row, "import_status") or "").strip()
        status = normalize(raw_status)
        status_counts[raw_status] = status_counts.get(raw_status, 0) + 1
        amount = parse_amount(get(row, "sales_amount"))
        raw_date = get(row, "date")
        transaction_date = parse_date_value(raw_date)
        note = str(get(row, "quality_notes") or "").strip() or None
        if status == "review excluded":
            flagged_review_rows.append({
                "sourceRow": row_number,
                "transactionDate": parse_date_value(raw_date).isoformat() if parse_date_value(raw_date) else None,
                "clientName": str(get(row, "client") or "").strip() or None,
                "productDescription": str(get(row, "product") or "").strip() or None,
                "customerType": str(get(row, "customer_type") or "").strip() or None,
                "siNumber": str(get(row, "si") or "").strip() or None,
                "qualityNotes": note,
            })
        if amount is None and status == "included":
            errors.append({"sheet": "Clean Sales Records", "row": row_number, "messages": ["Sales Amount is blank or invalid; it is not treated as zero."]})
        if status == "included" and transaction_date is None:
            errors.append({"sheet": "Clean Sales Records", "row": row_number, "messages": ["An Included record has a missing or invalid transaction date."]})
        if status not in {"included", "review excluded", "possible duplicate excluded"}:
            errors.append({"sheet": "Clean Sales Records", "row": row_number, "messages": ["Import Status is not a recognized value."]})
        if status not in imported_statuses or (amount is None and status == "included"):
            continue

        customer_raw = str(get(row, "customer_type") or "").strip()
        customer_norm = normalize(customer_raw)
        customer_type = customer_norm if customer_norm in {"government", "private"} else None
        product = str(get(row, "product") or "").strip() or None
        client = str(get(row, "client") or "").strip() or None
        po = str(get(row, "po") or "").strip() or None
        si = str(get(row, "si") or "").strip() or None
        dr = str(get(row, "dr") or "").strip() or None
        government_amount = parse_amount(get(row, "government_amount"))
        private_amount = parse_amount(get(row, "private_amount"))
        quantity = parse_amount(get(row, "quantity"))
        unit_price = parse_amount(get(row, "unit_price"))
        source_file = str(get(row, "source_file") or "").strip() or None
        source_sheet = str(get(row, "source_sheet") or "").strip() or None
        source_row_value = get(row, "source_row")
        try:
            source_row = int(source_row_value) if source_row_value not in (None, "") else row_number
        except (ValueError, TypeError):
            source_row = row_number

        source_payload = {header: safe_value(value) for header, value in zip(source_headers["Clean Sales Records"], row)}
        fingerprint_fields = [
            transaction_date.isoformat() if transaction_date else "",
            normalize(client), normalize(product), customer_type or normalize(customer_raw),
            normalize(po), normalize(si), normalize(dr), f"{amount:.2f}",
        ]
        fingerprint = hashlib.sha256("|".join(fingerprint_fields).encode("utf-8")).hexdigest()
        if status == "included" and fingerprint in exact_fingerprints:
            duplicate_rows += 1
            errors.append({"sheet": "Clean Sales Records", "row": row_number, "messages": ["An Included transaction exactly duplicates another Included row."]})
            continue
        if status == "included":
            exact_fingerprints.add(fingerprint)
        transaction = {
            "transactionDate": transaction_date.isoformat() if transaction_date else None,
            "clientName": client,
            "productDescription": product,
            "customerType": customer_type,
            "customerTypeRaw": customer_raw or None,
            "poNumber": po,
            "siNumber": si,
            "drNumber": dr,
            "governmentAmount": float(government_amount) if government_amount is not None else None,
            "privateAmount": float(private_amount) if private_amount is not None else None,
            "salesAmount": float(amount),
            "quantity": float(quantity) if quantity is not None else None,
            "unit": str(get(row, "unit") or "").strip() or None,
            "unitPrice": float(unit_price) if unit_price is not None else None,
            "documentType": str(get(row, "document_type") or "").strip() or None,
            "sourceFile": source_file,
            "sourceSheet": source_sheet,
            "sourceRow": source_row,
            "importStatus": raw_status,
            "qualityNotes": note,
            "recordFingerprint": fingerprint,
            "sourceRecord": source_payload,
        }
        transactions.append(transaction)
        if status == "included" and transaction_date is not None:
            month = transaction_date.strftime("%Y-%m")
            computed_monthly[month] = computed_monthly.get(month, Decimal("0.00")) + amount
            computed_counts[month] = computed_counts.get(month, 0) + 1

    _, month_indexes = header_indexes("Monthly Revenue")
    month_rows = list(workbook["Monthly Revenue"].iter_rows(values_only=True))[1:]
    monthly_revenue: list[dict] = []
    monthly_errors: list[dict] = []
    seen_months: set[str] = set()
    for row_number, row in enumerate(month_rows, start=2):
        if not any(value is not None and str(value).strip() for value in row):
            continue
        month_index = next((i for i, h in enumerate(source_headers["Monthly Revenue"]) if normalize(h) == "month"), -1)
        revenue_index = next((i for i, h in enumerate(source_headers["Monthly Revenue"]) if normalize(h) == "recorded revenue php"), -1)
        count_index = next((i for i, h in enumerate(source_headers["Monthly Revenue"]) if normalize(h) == "records"), -1)
        coverage_index = next((i for i, h in enumerate(source_headers["Monthly Revenue"]) if normalize(h) == "coverage"), -1)
        notes_index = next((i for i, h in enumerate(source_headers["Monthly Revenue"]) if normalize(h) == "notes"), -1)
        month = str(row[month_index] if month_index >= 0 and month_index < len(row) else "").strip()
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
            continue
        if month in seen_months:
            monthly_errors.append({"sheet": "Monthly Revenue", "row": row_number, "messages": ["Duplicate month in Monthly Revenue."]})
            continue
        seen_months.add(month)
        raw_revenue = row[revenue_index] if revenue_index >= 0 and revenue_index < len(row) else None
        revenue = parse_amount(raw_revenue)
        if raw_revenue is not None and revenue is None:
            monthly_errors.append({"sheet": "Monthly Revenue", "row": row_number, "messages": ["Recorded Revenue is invalid."]})
        raw_count = row[count_index] if count_index >= 0 and count_index < len(row) else None
        try:
            record_count = int(raw_count) if raw_count is not None and str(raw_count).strip() else None
        except (TypeError, ValueError):
            record_count = None
            monthly_errors.append({"sheet": "Monthly Revenue", "row": row_number, "messages": ["Monthly record count is invalid."]})
        monthly_revenue.append({
            "month": month,
            "revenue": float(revenue) if revenue is not None else None,
            "records": record_count,
            "coverage": str(row[coverage_index] or "").strip() if coverage_index >= 0 and coverage_index < len(row) else "",
            "notes": str(row[notes_index] or "").strip() if notes_index >= 0 and notes_index < len(row) else "",
        })

    reconciliation: list[dict] = []
    for entry in monthly_revenue:
        month = entry["month"]
        included_amount = computed_monthly.get(month, Decimal("0.00"))
        included_count = computed_counts.get(month, 0)
        sheet_amount = Decimal(str(entry["revenue"])) if entry["revenue"] is not None else None
        if sheet_amount != (included_amount if included_count else None) or entry["records"] != (included_count if included_count else None):
            reconciliation.append({
                "month": month,
                "transactionRevenue": float(included_amount) if included_count else None,
                "monthlySheetRevenue": entry["revenue"],
                "transactionRecordCount": included_count or None,
                "monthlySheetRecordCount": entry["records"],
            })

    error_list = errors + monthly_errors
    included = [row for row in transactions if normalize(row["importStatus"]) == "included"]
    review_rows = flagged_review_rows
    monthly_missing = [entry["month"] for entry in monthly_revenue if entry["revenue"] is None]
    forecast_records = [
        {"date": entry["month"] + "-01", "salesAmount": entry["revenue"], "source": "Monthly Revenue worksheet"}
        for entry in monthly_revenue if entry["revenue"] is not None
    ]
    flagged_sheet_rows = row_count_by_sheet.get("Review Flags", 0)
    result = {
        "valid": not error_list and not reconciliation,
        "sourceSheets": [{"name": sheet.title, "nonemptyRows": row_count_by_sheet.get(sheet.title, 0)} for sheet in workbook.worksheets],
        "sourceHeaders": source_headers,
        "sourceRecords": source_records,
        "transactions": [row for row in transactions if normalize(row["importStatus"]) == "included"],
        "forecastRecords": forecast_records,
        "monthlyRevenue": monthly_revenue,
        "reconciliationErrors": reconciliation,
        "rawRowCount": row_count_by_sheet.get("Clean Sales Records", 0),
        "validRows": len(included),
        "reviewRows": len(review_rows),
        "duplicateRows": sum(count for label, count in status_counts.items() if "duplicate" in normalize(label) and "excluded" in normalize(label)) + duplicate_rows,
        "excludedDuplicateRows": sum(count for label, count in status_counts.items() if "duplicate" in normalize(label) and "excluded" in normalize(label)),
        "invalidRows": len(error_list),
        "errors": error_list[:100],
        "errorsTruncated": len(error_list) > 100,
        "reviewFlagRows": max(0, flagged_sheet_rows - 1),
        "unresolvedReviewRows": review_rows,
        "referenceDocumentRows": row_count_by_sheet.get("Reference Documents", 0),
        "excludedCancellationRows": row_count_by_sheet.get("Excluded Cancellations", 0),
        "statusCounts": status_counts,
        "historicalStartDate": min((row["transactionDate"] for row in included if row["transactionDate"]), default=None),
        "historicalEndDate": max((row["transactionDate"] for row in included if row["transactionDate"]), default=None),
        "observedMonths": len(forecast_records),
        "missingMonths": monthly_missing,
        "preview": [row for row in transactions if normalize(row["importStatus"]) == "included"][:20],
    }
    workbook.close()
    return result


def parse_date_value(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value.strip()[:10])
        except ValueError:
            return None
    return None
