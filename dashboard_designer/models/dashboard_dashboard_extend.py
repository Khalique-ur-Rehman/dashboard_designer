# dashboard_designer/models/dashboard_dashboard_extend.py

from odoo import models, fields, api

class Dashboard(models.Model):
    _inherit = "dashboard.dashboard"

    # extra computed counts
    chart_count = fields.Integer(
        string="Charts",
        compute="_compute_widget_counts",
        store=False,
    )
    kpi_count = fields.Integer(
        string="KPIs",
        compute="_compute_widget_counts",
        store=False,
    )
    text_count = fields.Integer(
        string="Text Blocks",
        compute="_compute_widget_counts",
        store=False,
    )

    # per‑user bookmarks
    bookmark_user_ids = fields.Many2many(
        "res.users",
        "dashboard_bookmark_rel",
        "dashboard_id",
        "user_id",
        string="Bookmarked By",
    )

    is_bookmarked = fields.Boolean(
        string="Bookmarked",
        compute="_compute_is_bookmarked",
        inverse="_inverse_is_bookmarked",
        store=False,
    )

    @api.depends("item_ids.type")
    def _compute_widget_counts(self):
        for dash in self:
            dash.chart_count = len(dash.item_ids.filtered(lambda i: i.type == "chart"))
            dash.kpi_count = len(dash.item_ids.filtered(lambda i: i.type == "kpi"))
            dash.text_count = len(dash.item_ids.filtered(lambda i: i.type == "text"))

    @api.depends("bookmark_user_ids")
    def _compute_is_bookmarked(self):
        user = self.env.user
        for dash in self:
            dash.is_bookmarked = user in dash.bookmark_user_ids

    def _inverse_is_bookmarked(self):
        user = self.env.user
        for dash in self:
            if dash.is_bookmarked:
                dash.bookmark_user_ids = [(4, user.id)]
            else:
                dash.bookmark_user_ids = [(3, user.id)]

    @api.model
    def get_dashboard_home_data(self):
        """Return counts and dashboard list for the home screen."""
        Dashboard = self.env["dashboard.dashboard"]
        Item = self.env["dashboard.item"]

        dashboards = Dashboard.search([])
        all_dashboards = len(dashboards)
        all_charts = Item.search_count([("type", "=", "chart")])
        all_kpis = Item.search_count([("type", "=", "kpi")])
        all_texts = Item.search_count([("type", "=", "text")])

        bookmarked = dashboards.filtered(
            lambda d: self.env.user in d.bookmark_user_ids
        )

        return {
            "counts": {
                "all_dashboards": all_dashboards,
                "all_charts": all_charts,
                "all_kpis": all_kpis,
                "all_texts": all_texts,
                "bookmarked_dashboards": len(bookmarked),
            },
            "dashboards": [
                {
                    "id": d.id,
                    "name": d.name,
                    "subtitle": d.subtitle or "",
                    "chart_count": d.chart_count,
                    "kpi_count": d.kpi_count,
                    "text_count": d.text_count,
                    "is_bookmarked": d.is_bookmarked,
                }
                for d in dashboards
            ],
        }