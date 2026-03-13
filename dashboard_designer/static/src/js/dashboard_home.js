/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { session } from "@web/session";

export class DashboardHome extends Component {
    setup() {
        this.actionService = useService("action");
        this.orm = useService("orm");
        this.notification = useService("notification");

        this.state = useState({
            loading: true,
            counts: {},
            dashboards: [],
            filter: "all",  // "all" | "bookmarked"
            generatingInsights: {}, // Track which dashboards are generating insights
        });

        onWillStart(async () => {
            await this.loadData();
        });
    }

    get userName() {
        // Get username from session
        return session.user_context?.name || session.name || "User";
    }

    async loadData() {
        this.state.loading = true;
        try {
            const res = await this.orm.call(
                "dashboard.dashboard",
                "get_dashboard_home_data",
                []
            );

            console.log("[DashboardHome] Server Response:", res);
            console.log("[DashboardHome] Counts:", res.counts);
            console.log("[DashboardHome] Dashboards array length:", res.dashboards?.length);
            console.log("[DashboardHome] Dashboards:", res.dashboards);

            this.state.counts = res.counts || {
                all_dashboards: 0,
                all_charts: 0,
                all_kpis: 0,
                bookmarked_dashboards: 0,
                all_lists: 0
            };
            this.state.dashboards = res.dashboards || [];

            console.log("[DashboardHome] State after load - dashboards count:", this.state.dashboards.length);
        } catch (e) {
            console.error("[DashboardHome] loadData error:", e);
            this.state.counts = {
                all_dashboards: 0,
                all_charts: 0,
                all_kpis: 0,
                bookmarked_dashboards: 0,
                all_lists: 0
            };
            this.state.dashboards = [];

            this.notification.add(
                "Failed to load dashboards. Please refresh the page.",
                { type: "danger" }
            );
        } finally {
            this.state.loading = false;
        }
    }

    get filteredDashboards() {
        const filtered = this.state.filter === "bookmarked"
            ? this.state.dashboards.filter((d) => d.is_bookmarked)
            : this.state.dashboards;

        console.log("[DashboardHome] Filtered dashboards:", filtered.length, "Filter:", this.state.filter);
        return filtered;
    }

    setFilter(filter) {
        console.log("[DashboardHome] Setting filter to:", filter);
        this.state.filter = filter;
    }

    async onToggleBookmark(dash) {
        try {
            // Toggle bookmark flag on the server
            await this.orm.call("dashboard.dashboard", "write", [
                [dash.id],
                { is_bookmarked: !dash.is_bookmarked },
            ]);
            dash.is_bookmarked = !dash.is_bookmarked;

            // Update counts
            if (dash.is_bookmarked) {
                this.state.counts.bookmarked_dashboards =
                    (this.state.counts.bookmarked_dashboards || 0) + 1;
            } else {
                this.state.counts.bookmarked_dashboards =
                    Math.max(0, (this.state.counts.bookmarked_dashboards || 0) - 1);
            }

            this.notification.add(
                dash.is_bookmarked ? "Dashboard bookmarked" : "Bookmark removed",
                { type: "success" }
            );
        } catch (e) {
            console.error("[DashboardHome] toggle bookmark error:", e);
            this.notification.add(
                "Failed to update bookmark. Please try again.",
                { type: "danger" }
            );
        }
    }

    onOpenDashboard(dash) {
        console.log("[DashboardHome] Opening dashboard:", dash.id, dash.name);
        // Open dashboard studio with dashboard_id in context (not params)
        this.actionService.doAction({
            type: "ir.actions.client",
            tag: "dashboard_studio",
            context: {
                dashboard_id: dash.id,
            },
        });
    }

    async onGenerateAIInsight(dash) {
        console.log("[DashboardHome] Generating AI Insight for dashboard:", dash.id);

        // Prevent multiple simultaneous requests for the same dashboard
        if (this.state.generatingInsights[dash.id]) {
            console.log("[DashboardHome] Already generating insights for dashboard:", dash.id);
            return;
        }

        // Mark as generating
        this.state.generatingInsights[dash.id] = true;

        try {
            // Show loading notification
            this.notification.add(
                `Generating AI insights for "${dash.name}"...`,
                { type: "info" }
            );

            // Call backend to generate AI insights for all widgets in the dashboard
            const result = await this.orm.call(
                "dashboard.dashboard",
                "generate_dashboard_insights",
                [[dash.id]]
            );

            console.log("[DashboardHome] AI Insights generated:", result);

            // Check if successful
            if (result.success) {
                const successCount = result.successful || 0;
                const totalCount = result.total_widgets || 0;

                if (totalCount === 0) {
                    this.notification.add(
                        result.message || "No chart widgets found in this dashboard.",
                        { type: "warning" }
                    );
                } else if (successCount === totalCount) {
                    this.notification.add(
                        `Successfully generated ${successCount} AI insight${successCount !== 1 ? 's' : ''}! Open the dashboard to view them.`,
                        { type: "success" }
                    );
                } else {
                    this.notification.add(
                        `Generated ${successCount} of ${totalCount} insights. Some widgets may have errors.`,
                        { type: "warning" }
                    );
                }

                // Show detailed results in console for debugging
                if (result.insights && result.insights.length > 0) {
                    console.log("[DashboardHome] Insight details:");
                    result.insights.forEach(insight => {
                        if (insight.success) {
                            console.log(`✓ ${insight.widget_name}:`, insight.insight);
                        } else {
                            console.error(`✗ ${insight.widget_name}:`, insight.error);
                        }
                    });
                }
            } else {
                this.notification.add(
                    "Failed to generate AI insights. Please try again.",
                    { type: "danger" }
                );
            }
        } catch (error) {
            console.error("[DashboardHome] Error generating AI insights:", error);

            // Provide more specific error messages
            let errorMessage = "Failed to generate AI insights. ";

            if (error.message && error.message.includes("destroyed")) {
                errorMessage += "Some widgets may have been deleted. Try cleaning up the dashboard first.";
            } else if (error.message) {
                errorMessage += error.message;
            } else {
                errorMessage += "Please try again.";
            }

            this.notification.add(errorMessage, { type: "danger" });
        } finally {
            // Clear generating flag
            delete this.state.generatingInsights[dash.id];
        }
    }

    async onCleanupDashboard(dash) {
        console.log("[DashboardHome] Cleaning up dashboard:", dash.id);

        try {
            this.notification.add(
                `Cleaning up invalid widgets in "${dash.name}"...`,
                { type: "info" }
            );

            const result = await this.orm.call(
                "dashboard.dashboard",
                "cleanup_invalid_widgets",
                [[dash.id]]
            );

            console.log("[DashboardHome] Cleanup result:", result);

            if (result.success) {
                const removedCount = result.removed_count || 0;
                if (removedCount > 0) {
                    this.notification.add(
                        `Removed ${removedCount} invalid widget${removedCount !== 1 ? 's' : ''}.`,
                        { type: "success" }
                    );
                } else {
                    this.notification.add(
                        "No invalid widgets found.",
                        { type: "info" }
                    );
                }

                // Reload data to reflect changes
                await this.loadData();
            }
        } catch (error) {
            console.error("[DashboardHome] Cleanup error:", error);
            this.notification.add(
                "Failed to cleanup dashboard. Please try again.",
                { type: "danger" }
            );
        }
    }

    onAddNewDashboard() {
        // Open dashboard creation form or action
        this.actionService.doAction({
            type: "ir.actions.act_window",
            res_model: "dashboard.dashboard",
            views: [[false, "form"]],
            target: "current",
        });
    }

    isGeneratingInsights(dashId) {
        return !!this.state.generatingInsights[dashId];
    }
}

DashboardHome.template = "dashboard_designer.DashboardHome";

// Register as a client action
registry.category("actions").add("dashboard_home_client_action", DashboardHome);