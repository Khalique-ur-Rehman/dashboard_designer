from odoo import http

class DashboardHomeController(http.Controller):

    @http.route(
        "/dashboard_designer/home_data",
        type="json",
        auth="user"
    )
    def dashboard_home_data(self):
        env = http.request.env
        return env["dashboard.dashboard"].get_dashboard_home_data()

    @http.route(
        "/dashboard_designer/toggle_bookmark",
        type="json",
        auth="user"
    )
    def toggle_bookmark(self, dashboard_id):
        env = http.request.env
        dash = env["dashboard.dashboard"].browse(int(dashboard_id)).exists()
        if not dash:
            return False
        dash.is_bookmarked = not dash.is_bookmarked
        return {"id": dash.id, "is_bookmarked": dash.is_bookmarked}