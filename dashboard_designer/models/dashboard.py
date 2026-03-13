from datetime import datetime

from odoo import models, fields, api
from odoo.tools.safe_eval import safe_eval
from odoo.tools import html2plaintext
import logging
import hashlib
import json

_logger = logging.getLogger(__name__)


class Dashboard(models.Model):
    _name = "dashboard.dashboard"
    _description = "Custom Dashboard"
    _order = "name"

    name = fields.Char(required=True)
    subtitle = fields.Char("Subtitle")
    active = fields.Boolean(default=True)
    color = fields.Integer("Color", help="Used in list views or tags")

    # Theme for this dashboard (used by preview/PDF)
    theme = fields.Selection(
        [
            ("soft", "Soft Pastel"),
            ("dark", "Dark"),
            ("minimal", "Minimal"),
        ],
        string="Theme",
        default="soft",
        required=True,
    )

    item_ids = fields.One2many(
        "dashboard.item",
        "dashboard_id",
        string="Dashboard Items",
    )

    widget_count = fields.Integer(
        string="Widgets",
        compute="_compute_widget_count",
        store=False,
    )

    @api.depends("item_ids")
    def _compute_widget_count(self):
        for dash in self:
            dash.widget_count = len(dash.item_ids)

    def action_print_dashboard(self):
        """Return the QWeb PDF report action for this dashboard.
        Requires an ir.actions.report with xml_id 'dashboard_designer.report_dashboard'.
        """
        self.ensure_one()
        return self.env.ref("dashboard_designer.report_dashboard").report_action(self)

    def action_open_studio(self):
        """Open the OWL Dashboard Studio client action for this dashboard."""
        self.ensure_one()
        return {
            "type": "ir.actions.client",
            "tag": "dashboard_studio",  # must match JS registration
            "name": self.name or "Dashboard Studio",
            "context": {
                "dashboard_id": self.id,
            },
        }

    def generate_dashboard_insights(self):
        """Generate AI insights for all chart widgets in this dashboard."""
        self.ensure_one()

        results = []
        chart_items = self.item_ids.filtered(lambda x: x.type == 'chart')

        if not chart_items:
            return {
                'success': True,
                'insights': [],
                'total_widgets': 0,
                'successful': 0,
                'message': 'No chart widgets found in this dashboard.'
            }

        for item in chart_items:
            try:
                insight = item.get_ai_insight()
                results.append({
                    'widget_id': item.id,
                    'widget_name': item.name,
                    'insight': insight,
                    'success': True
                })
            except Exception as e:
                _logger.error("Error generating insight for widget %s: %s", item.id, str(e))
                results.append({
                    'widget_id': item.id,
                    'widget_name': item.name,
                    'error': str(e),
                    'success': False
                })

        return {
            'success': True,
            'insights': results,
            'total_widgets': len(chart_items),
            'successful': len([r for r in results if r.get('success')])
        }

    def cleanup_invalid_widgets(self):
        """Remove widgets that cause errors."""
        self.ensure_one()
        removed_count = 0
        for item in self.item_ids:
            try:
                # Try to access basic data
                _ = item.name
                if item.type == 'chart':
                    _ = item.get_chart_data()
            except Exception as e:
                _logger.warning("Removing invalid widget %s: %s", item.id, str(e))
                item.unlink()
                removed_count += 1

        return {
            'success': True,
            'removed_count': removed_count
        }


class DashboardItem(models.Model):
    _name = "dashboard.item"
    _description = "Dashboard Item / Widget"
    _order = "sequence, id"

    name = fields.Char(required=True)
    sequence = fields.Integer(default=10)

    dashboard_id = fields.Many2one(
        "dashboard.dashboard",
        string="Dashboard",
        required=True,
        ondelete="cascade",
    )

    type = fields.Selection(
        [
            ("kpi", "KPI Card"),
            ("text", "Text Block"),
            ("chart", "Chart"),
        ],
        string="Type",
        default="kpi",
        required=True,
    )

    # -------------------------------------------------------------------------
    # Data configuration
    # -------------------------------------------------------------------------
    model_id = fields.Many2one(
        "ir.model",
        string="Model",
        domain=[("transient", "=", False)],
        help="Model the widget is based on.",
    )

    measure_field_id = fields.Many2one(
        "ir.model.fields",
        string="Measure Field",
        domain="""
            [
                ("model_id", "=", model_id),
                ("ttype", "in", ("integer", "float", "monetary"))
            ]
        """,
        help="Numeric field to aggregate (sum/avg). Leave empty for record count.",
    )

    aggregation = fields.Selection(
        [
            ("sum", "Sum"),
            ("avg", "Average"),
            ("count", "Count"),
        ],
        string="Aggregation",
        default="count",
        required=True,
    )

    domain = fields.Char(
        string="Domain",
        help="Record filter, e.g. [('state','=','sale')].",
    )

    # Chart-specific config
    chart_type = fields.Selection(
        [
            ("bar", "Bar"),
            ("line", "Line"),
            ("pie", "Pie / Donut"),
            ("scatter", "Scatter Plot"),
            ("radar", "Radar Chart"),
            ("gauge", "Gauge"),
            ("funnel", "Funnel"),
            ("heatmap", "Heatmap"),
            ("sankey", "Sankey Diagram"),
        ],
        string="Chart Type",
        default="bar",
    )

    groupby_field_id = fields.Many2one(
        "ir.model.fields",
        string="Group By",
        domain="""
            [
                ("model_id", "=", model_id),
                ("ttype", "in", ("many2one", "char", "selection", "date", "datetime"))
            ]
        """,
        help="Field used for grouping on the X-axis / categories.",
    )

    limit = fields.Integer(
        string="Max Categories",
        default=10,
    )

    # Date field used for global filters (e.g., order date on sale.order)
    date_field_id = fields.Many2one(
        "ir.model.fields",
        string="Date Field for Global Filter",
        domain="""
            [
                ("model_id", "=", model_id),
                ("ttype", "in", ("date", "datetime"))
            ]
        """,
        help="Date/datetime field used for global date filters.",
    )

    # -------------------------------------------------------------------------
    # Visual configuration
    # -------------------------------------------------------------------------
    color = fields.Char(
        string="Card Color Class",
        help="CSS class, e.g. 'o_dash_card_blue', 'o_dash_card_green'.",
    )
    icon = fields.Char(
        string="Icon Class",
        help="e.g. 'fa fa-line-chart'.",
    )
    text = fields.Text(
        string="Text",
        help="Description or subtitle shown on the card (may contain HTML).",
    )

    display_text = fields.Text(
        string="Display Text",
        compute="_compute_display_text",
        store=False,
    )

    # KPI value
    value = fields.Float(
        string="Numeric Value",
        compute="_compute_value",
        store=False,
    )
    value_text = fields.Char(
        string="Display Value",
        compute="_compute_value",
        store=False,
    )

    # -------------------------------------------------------------------------
    # HELPERS
    # -------------------------------------------------------------------------
    def _build_domain_with_global_filters(self):
        """Return base domain + global date filter (from context) if configured."""
        self.ensure_one()

        # start from configured domain
        dom = []
        if self.domain:
            try:
                dom = safe_eval(self.domain)
            except Exception:
                dom = []

        # apply global date range filter from context if available
        ctx = self.env.context or {}
        date_range = ctx.get("dashboard_date_range")
        if date_range and self.date_field_id:
            field_name = self.date_field_id.name
            start = date_range.get("start")
            end = date_range.get("end")

            if start:
                if isinstance(start, datetime):
                    start = start.date().isoformat()
                dom.append((field_name, ">=", start))
            if end:
                if isinstance(end, datetime):
                    end = end.date().isoformat()
                dom.append((field_name, "<=", end))

        return dom

    @api.model
    def get_sales_model_and_fields(self):
        """Return basic info for sale.order model and a few key fields."""
        model = self.env["ir.model"].search([("model", "=", "sale.order")], limit=1)
        if not model:
            return {}

        fields = self.env["ir.model.fields"].search(
            [
                ("model_id", "=", model.id),
                ("name", "in", ["amount_total", "date_order"]),
            ]
        )
        return {
            "model_id": model.id,
            "fields": {f.name: f.id for f in fields},
        }

    # -------------------------------------------------------------------------
    # COMPUTE METHODS
    # -------------------------------------------------------------------------
    @api.depends("text")
    def _compute_display_text(self):
        for item in self:
            item.display_text = html2plaintext(item.text or "").strip()

    @api.depends("type", "model_id", "measure_field_id", "aggregation", "domain")
    def _compute_value(self):
        for item in self:
            item.value = 0.0
            item.value_text = ""
            if item.type != "kpi" or not item.model_id:
                continue

            Model = self.env[item.model_id.model]

            # domain with global filters
            dom = item._build_domain_with_global_filters()

            if item.aggregation == "count" or not item.measure_field_id:
                count = Model.search_count(dom)
                item.value = float(count)
                item.value_text = str(count)
            else:
                field_name = item.measure_field_id.name
                data = Model.read_group(dom, [field_name], [])
                total = data[0][field_name] if data else 0.0

                if item.aggregation == "avg":
                    count = Model.search_count(dom)
                    avg = (total / count) if count else 0.0
                    item.value = avg
                    item.value_text = f"{avg:.2f}"
                else:
                    item.value = total
                    item.value_text = f"{total:.2f}"

    def get_chart_data(self):
        """Return aggregated data for this chart item."""
        self.ensure_one()
        if self.type != "chart" or not self.model_id or not self.groupby_field_id:
            return {"labels": [], "values": []}

        Model = self.env[self.model_id.model]

        # domain with global filters
        dom = self._build_domain_with_global_filters()

        measure_field = self.measure_field_id.name if self.measure_field_id else "id"
        groupby_field = self.groupby_field_id.name

        data = Model.read_group(dom, [measure_field], [groupby_field], limit=self.limit)

        labels = []
        values = []
        for row in data:
            label = row.get(groupby_field)
            if isinstance(label, tuple):
                label = label[1]
            label = label or "Unknown"
            labels.append(str(label))
            values.append(row.get(measure_field, 0.0))

        return {"labels": labels, "values": values}

    # -------------------------------------------------------------------------
    # AI INSIGHT HELPERS
    # -------------------------------------------------------------------------

    def _is_ai_configured(self):
        """Check if AI API credentials are set."""
        IrConfig = self.env['ir.config_parameter'].sudo()
        api_key = IrConfig.get_param('dashboard_designer.ai_api_key')
        api_endpoint = IrConfig.get_param('dashboard_designer.ai_endpoint')
        return bool(api_key) and bool(api_endpoint)

    def _build_ai_summary_payload(self):
        """Prepare a small dict of this chart's data for AI use."""
        self.ensure_one()
        data = self.get_chart_data()
        return {
            "name": self.name,
            "model": self.model_id.model if self.model_id else "",
            "chart_type": self.chart_type,
            "labels": data.get("labels", []),
            "values": data.get("values", []),
        }

    def _get_data_hash(self, payload):
        """Generate hash of data to use as cache key."""
        data_str = json.dumps(payload, sort_keys=True)
        return hashlib.md5(data_str.encode()).hexdigest()

    def _build_ai_prompt(self, payload):
        """Build optimized prompt for AI."""
        values = payload["values"]

        if not values:
            return ""

        # Calculate statistics
        avg_val = sum(values) / len(values)
        max_val = max(values)
        min_val = min(values)

        # Determine trend
        if len(values) > 1:
            trend = "increasing" if values[-1] > values[0] else "decreasing"
        else:
            trend = "stable"

        prompt = f"""You are a data analytics assistant for an Odoo ERP dashboard.

Analyze this {payload['chart_type']} chart and provide a concise 2-sentence insight.

Chart Details:
- Name: {payload['name']}
- Data Model: {payload['model']}
- Labels: {', '.join(str(l) for l in payload['labels'][:10])}  # Limit to first 10
- Values: {', '.join(str(v) for v in payload['values'][:10])}

Quick Stats:
- Average: {avg_val:.2f}
- Range: {min_val:.2f} to {max_val:.2f}
- Trend: {trend}

Focus on:
1. The most significant pattern or trend
2. One actionable business insight

Keep it under 50 words, professional tone."""

        return prompt

    def _call_external_ai_api(self, prompt, timeout=15):
        """Call an external AI service with timeout.

        Args:
            prompt: The prompt to send to AI
            timeout: Request timeout in seconds

        Returns:
            str: AI generated insight

        Raises:
            Various exceptions for different failure modes
        """
        IrConfig = self.env['ir.config_parameter'].sudo()
        api_key = IrConfig.get_param('dashboard_designer.ai_api_key')
        api_endpoint = IrConfig.get_param('dashboard_designer.ai_endpoint',
                                          'https://api.openai.com/v1/chat/completions')
        model = IrConfig.get_param('dashboard_designer.ai_model', 'gpt-4o-mini')

        if not api_key:
            raise ValueError("AI API key not configured")

        # TODO: Implement actual API call
        # Example with OpenAI:
        # import requests
        # headers = {
        #     'Authorization': f'Bearer {api_key}',
        #     'Content-Type': 'application/json'
        # }
        # data = {
        #     'model': model,
        #     'messages': [{'role': 'user', 'content': prompt}],
        #     'max_tokens': 150,
        #     'temperature': 0.7
        # }
        # response = requests.post(api_endpoint, headers=headers, json=data, timeout=timeout)
        # response.raise_for_status()
        # return response.json()['choices'][0]['message']['content'].strip()

        return (
            "AI Insight placeholder: configure _call_external_ai_api() "
            "to connect this dashboard to a real language model."
        )

    def get_ai_insight(self):
        """Return a short natural-language explanation for this chart."""
        try:
            self.ensure_one()

            # Log for debugging
            _logger.info("=== AI Insight called for widget ID: %s, Name: %s, Type: %s ===",
                         self.id, self.name, self.type)

            # Validate widget type
            if self.type != "chart":
                return "AI insights are only available for chart widgets."

            # Check if model and fields are configured
            if not self.model_id:
                return "This chart is not connected to a data source. Please configure the model in the widget settings."

            # Get chart data safely
            values = []
            labels = []

            try:
                _logger.info("Calling get_chart_data for widget %s", self.id)
                chart_data = self.get_chart_data()
                _logger.info("Chart data received: %s", chart_data)

                values = chart_data.get("values", [])
                labels = chart_data.get("labels", [])

            except Exception as e:
                _logger.error("Error calling get_chart_data: %s", str(e), exc_info=True)
                return f"Unable to load chart data. Error: {str(e)}"

            # Check if we have data
            if not values or len(values) == 0:
                return "📊 No data available yet. Try adding some records to see insights."

            # Convert values to floats safely
            safe_values = []
            for v in values:
                try:
                    safe_values.append(float(v))
                except (ValueError, TypeError):
                    _logger.warning("Skipping invalid value: %s", v)
                    continue

            if not safe_values:
                return "Chart data contains invalid values."

            values = safe_values

            # Calculate statistics
            try:
                total = sum(values)
                avg_val = total / len(values)
                max_val = max(values)
                min_val = min(values)
                max_idx = values.index(max_val)

                _logger.info("Stats calculated - Avg: %s, Max: %s, Min: %s", avg_val, max_val, min_val)

            except Exception as e:
                _logger.error("Error calculating stats: %s", str(e))
                return "Unable to analyze data."

            # Get label for maximum value
            max_label = "Unknown"
            if labels and max_idx < len(labels):
                max_label = str(labels[max_idx])

            # Build insight text
            insight = f"📊 Peak value of {max_val:.1f} occurs at '{max_label}'. "

            # Add trend analysis if we have multiple points
            if len(values) > 1:
                first_val = values[0]
                last_val = values[-1]

                if first_val != 0:
                    change_pct = ((last_val - first_val) / first_val) * 100

                    if change_pct > 10:
                        insight += f"Strong growth trend (+{change_pct:.0f}%). "
                    elif change_pct < -10:
                        insight += f"Declining trend ({change_pct:.0f}%). "
                    else:
                        insight += "Stable trend. "

                insight += f"Average: {avg_val:.1f}."

                # Add recommendation
                if last_val > avg_val * 1.2:
                    insight += " 💡 Above average performance."
                elif last_val < avg_val * 0.8:
                    insight += " ⚠️ Below average, review recommended."
            else:
                insight += f"Single data point: {values[0]:.1f}."

            _logger.info("Generated insight: %s", insight)
            return insight

        except Exception as e:
            _logger.error("=== CRITICAL ERROR in get_ai_insight ===")
            _logger.error("Widget ID: %s", getattr(self, 'id', 'unknown'))
            _logger.error("Error: %s", str(e), exc_info=True)
            return f"System error: {str(e)[:100]}"