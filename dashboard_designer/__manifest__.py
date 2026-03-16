{
    "name": "Dashboard Studio",
    "summary": "Create beautiful dashboards with KPI cards, charts, themes and printable reports.",
    "description": """
Dashboard Designer
Key Features
============
- Create multiple dashboards
- Add KPI, text and chart widgets
- Theme-aware dashboard preview
- Printable PDF dashboard report
- Export dashboard as PNG
- Dashboard home with summary tiles and cards
This module allows users to build modern analytics dashboards inside Odoo without coding.
""",
    "version": "18.0.1.0.0",
    "category": "Reporting",
    "author": "eaxeesoft",
    "website": "https://eaxeesoft.com/",
    "license": "OPL-1",
    "images": ["static/description/banner.png"],

    # --- PRICE CONFIGURATION ---
    "price": 550.00,
    "currency": "USD",
    # ---------------------------
    "support": "support@eaxeesoft.com",
    "depends": ["base", "web"],
    "data": [
        "security/ir.model.access.csv",
        "views/dashboard_views.xml",
        "views/dashboard_home_views.xml",
        "views/res_config_settings_views.xml",
        "report/dashboard_report.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "dashboard_designer/static/src/css/dashboard_theme.css",
            "dashboard_designer/static/lib/html2canvas/html2canvas.min.js",
            "dashboard_designer/static/src/js/dashboard_studio.esm.js",
            "dashboard_designer/static/src/xml/dashboard_studio.xml",
            "dashboard_designer/static/src/js/dashboard_home.js",
            "dashboard_designer/static/src/css/dashboard_home.css",
            "dashboard_designer/static/src/xml/dashboard_home_templates.xml",
        ],
    },
    "installable": True,
    "application": True,
}


