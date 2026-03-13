/** @odoo-module **/

import { Component, onWillStart, useState, onMounted, useEffect } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { registry } from "@web/core/registry";

const actionRegistry = registry.category("actions");

class DashboardStudio extends Component {
    setup() {
        this.orm = useService("orm");
        this.actionService = useService("action");

        const ctx = this.props.action.context || {};
        this.dashboardId = ctx.dashboard_id || null;

        this.state = useState({
            loading: true,
            dashboard: null,
            widgets: [],
            selectedId: null,
            activeTab: "styles",
            previewMode: false,
            draggedWidget: null,
            pages: [{ id: 1, name: "Main Dashboard", active: true, widgets: [] }],
            currentPageId: 1,
            globalFilters: {
                dateRange: { start: null, end: null, preset: "this_month" },
                customFilters: [],
            },
            globalTheme: {
                primaryColor: "#3b82f6",
                secondaryColor: "#8b5cf6",
                backgroundColor: "#0f0f23",
                cardBackground: "#191932",
                textColor: "#e5e7eb",
                fontFamily: "Inter",
                spacing: "comfortable",
            },
            widgetStylesMap: {},
            widgetDataSources: {},
            widgetRules: {},
            widgetEvents: {},
            showGlobalFilters: false,
            showThemeEditor: false,
            showVersionHistory: false,
            versions: [],
            viewportMode: "desktop",
            exportFormat: null,
            dataRefreshInterval: null,
        });

        this._salesInfo = null;

        onWillStart(this.loadData.bind(this));
        onMounted(() => {
            this.setupDragAndDrop();
            this.startRealTimeUpdates();
            this.applyGlobalTheme();
        });

        useEffect(() => {
            this.applyGlobalTheme();
        }, () => [this.state.globalTheme]);
    }

    // -------------------------------------------------------------------------
    // GETTERS
    // -------------------------------------------------------------------------
    get selectedWidget() {
        return this.state.widgets.find((w) => w.id === this.state.selectedId) || null;
    }

    get currentPageWidgets() {
        const currentPage = this.state.pages.find((p) => p.id === this.state.currentPageId);
        return currentPage ? currentPage.widgets : [];
    }

    getWidgetStyles(widgetId) {
        return (
            this.state.widgetStylesMap[widgetId] || {
                backgroundColor: "#1a1a2e",
                textColor: "#ffffff",
                borderRadius: "12",
                padding: "20",
                chartColor: "#3b82f6",
                xAxisLabels: "Q1,Q2,Q3,Q4",
                yAxisMin: "0",
                yAxisMax: "100",
            }
        );
    }

    getWidgetData(widgetId) {
        return (
            this.state.widgetDataSources[widgetId] || {
                type: "static",
                values: [],
                lastUpdated: null,
                  aiInsight: null,              // ADD THIS
                  aiInsightError: null,          // ADD THIS
            generatingInsight: false,
            }
        );
    }

    getWidgetRules(widgetId) {
        return this.state.widgetRules[widgetId] || [];
    }

    getWidgetEvents(widgetId) {
        return (
            this.state.widgetEvents[widgetId] || {
                onClick: { action: "", model: "", actionId: "", url: "" },
                onHover: { action: "" },
                onDoubleClick: null,
                refreshOnClick: false,
            }
        );
    }

    // -------------------------------------------------------------------------
    // THEME / REAL-TIME
    // -------------------------------------------------------------------------
    applyGlobalTheme() {
        const root = document.documentElement;
        root.style.setProperty("--primary-color", this.state.globalTheme.primaryColor);
        root.style.setProperty("--secondary-color", this.state.globalTheme.secondaryColor);
        root.style.setProperty("--bg-color", this.state.globalTheme.backgroundColor);
        root.style.setProperty("--card-bg", this.state.globalTheme.cardBackground);
        root.style.setProperty("--text-color", this.state.globalTheme.textColor);
        root.style.setProperty("--font-family", this.state.globalTheme.fontFamily);
    }

    _getDashboardContext() {
        const dr = this.state.globalFilters.dateRange || {};
        const toStr = (d) => {
            if (!d) return null;
            if (d instanceof Date) {
                return d.toISOString().slice(0, 10);
            }
            return d;
        };
        return {
            dashboard_date_range: {
                start: toStr(dr.start),
                end: toStr(dr.end),
            },
        };
    }

    startRealTimeUpdates() {
        this.state.dataRefreshInterval = setInterval(() => {
            this.updateRealTimeData();
        }, 15000);
    }

    async updateRealTimeData() {
        for (const widget of this.state.widgets) {
            await this.refreshWidget(widget.id);
        }
        this.render();
    }

    /**
 * Generate AI insight for a chart widget - FIXED VERSION
 * @param {number} widgetId - The widget ID to generate insight for
 */
async generateAiInsight(widgetId) {
    const widget = this.state.widgets.find((w) => w.id === widgetId);

    if (!widget || widget.type !== "chart") {
        console.warn("[AI Insight] Can only generate insights for chart widgets");
        return;
    }

    // Set loading state
    if (!this.state.widgetDataSources[widgetId]) {
        this.state.widgetDataSources[widgetId] = {
            type: "static",
            values: [],
            lastUpdated: null,
        };
    }

    this.state.widgetDataSources[widgetId].generatingInsight = true;
    this.state.widgetDataSources[widgetId].aiInsightError = null;
    this.state.widgetDataSources[widgetId].aiInsight = null; // Clear previous insight

    try {
        console.log("[AI Insight] Calling backend for widget", widgetId);

        // Call backend method to get AI insight
        const insight = await this.orm.call(
            "dashboard.item",
            "get_ai_insight",
            [[widgetId]]
        );

        console.log("[AI Insight] Received response:", insight);

        // Check if the response is an error message
        const isError =
            typeof insight === 'string' && (
                insight.includes('rate limit') ||
                insight.includes('AI service') ||
                insight.includes('unavailable') ||
                insight.includes('timed out') ||
                insight.includes('cannot connect') ||
                insight.includes('authentication failed') ||
                insight.includes('not properly configured') ||
                insight.includes('Please contact') ||
                insight.includes('Please wait') ||
                insight.includes('try again')
            );

        if (isError) {
            // This is an error message, not a valid insight
            console.warn("[AI Insight] Backend returned error:", insight);
            this.state.widgetDataSources[widgetId].aiInsightError = insight;
            this.state.widgetDataSources[widgetId].aiInsight = null;
        } else {
            // Valid insight received
            this.state.widgetDataSources[widgetId].aiInsight = insight;
            this.state.widgetDataSources[widgetId].aiInsightError = null;
            console.log("[AI Insight] Successfully generated for widget", widgetId);
        }

    } catch (error) {
        console.error("[AI Insight] Error calling backend:", error);

        // Store error message
        this.state.widgetDataSources[widgetId].aiInsightError =
            "Failed to generate AI insight. Please try again.";
        this.state.widgetDataSources[widgetId].aiInsight = null;
    } finally {
        // Clear loading state
        this.state.widgetDataSources[widgetId].generatingInsight = false;
    }
}

/**
 * Clear AI insight for a widget
 * @param {number} widgetId - The widget ID to clear insight for
 */
clearAiInsight(widgetId) {
    if (this.state.widgetDataSources[widgetId]) {
        this.state.widgetDataSources[widgetId].aiInsight = null;
        this.state.widgetDataSources[widgetId].aiInsightError = null;
    }
}

/**
 * Regenerate AI insight (convenience method)
 * @param {number} widgetId - The widget ID to regenerate insight for
 */
async regenerateAiInsight(widgetId) {
    // Clear existing insight first
    this.clearAiInsight(widgetId);

    // Wait a bit for UI to update
    await new Promise(resolve => setTimeout(resolve, 100));

    // Generate new insight
    await this.generateAiInsight(widgetId);
}
// Replace these functions in your DashboardStudio component

// -------------------------------------------------------------------------
// DRAG & DROP - FIXED
// -------------------------------------------------------------------------
setupDragAndDrop() {
    // Optional: Add any global drag listeners here if needed
    console.log("[DashboardStudio] Drag and drop initialized");
}

onDragStart(widget, event) {
    // Store widget ID instead of the whole object
    this.state.draggedWidget = widget;

    // Set the data transfer - use widget ID as string
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", widget.id.toString());

    // Add dragging class for visual feedback
    setTimeout(() => {
        event.target.classList.add("dd_widget_dragging");
    }, 0);

    console.log("[DragStart] Widget:", widget.name, "ID:", widget.id);
}

onDragEnd(event) {
    // Remove dragging class
    event.target.classList.remove("dd_widget_dragging");

    // Clear the dragged widget
    this.state.draggedWidget = null;

    console.log("[DragEnd]");
}

onDragOver(event) {
    // CRITICAL: Must prevent default to allow drop
    if (event.preventDefault) {
        event.preventDefault();
    }
    event.dataTransfer.dropEffect = "move";

    // Add visual feedback to drop target
    const target = event.currentTarget;
    if (target && !target.classList.contains("dd_widget_dragging")) {
        target.classList.add("dd_widget_drop_target");
    }

    return false;
}

onDragLeave(event) {
    // Remove drop target highlight when leaving
    const target = event.currentTarget;
    if (target) {
        target.classList.remove("dd_widget_drop_target");
    }
}

onDrop(targetWidget, event) {
    // Prevent default behavior
    if (event.stopPropagation) {
        event.stopPropagation();
    }
    if (event.preventDefault) {
        event.preventDefault();
    }

    // Remove drop target class
    event.currentTarget.classList.remove("dd_widget_drop_target");

    // Get dragged widget
    const draggedWidget = this.state.draggedWidget;

    if (!draggedWidget || draggedWidget.id === targetWidget.id) {
        console.log("[Drop] Invalid drop - same widget or no dragged widget");
        return false;
    }

    console.log("[Drop] Moving", draggedWidget.name, "to position of", targetWidget.name);

    // Create a copy of widgets array
    const widgets = [...this.state.widgets];

    // Find indices
    const draggedIndex = widgets.findIndex((w) => w.id === draggedWidget.id);
    const targetIndex = widgets.findIndex((w) => w.id === targetWidget.id);

    if (draggedIndex === -1 || targetIndex === -1) {
        console.error("[Drop] Widget not found in array");
        return false;
    }

    console.log("[Drop] Indices - Dragged:", draggedIndex, "Target:", targetIndex);

    // Remove dragged widget from array
    const [draggedItem] = widgets.splice(draggedIndex, 1);

    // Insert at target position
    widgets.splice(targetIndex, 0, draggedItem);

    // Update state
    this.state.widgets = widgets;

    // Update current page widgets
    const currentPage = this.state.pages.find(
        (p) => p.id === this.state.currentPageId
    );
    if (currentPage) {
        currentPage.widgets = [...widgets];
    }

    // Save order to backend
    this.saveWidgetOrder(widgets);

    console.log("[Drop] Reorder complete");

    return false;
}

async saveWidgetOrder(widgets) {
    try {
        console.log("[SaveOrder] Saving new widget order...");

        // Update sequence for all widgets
        const promises = widgets.map((widget, index) => {
            return this.orm.write("dashboard.item", [widget.id], {
                sequence: index,
            });
        });

        await Promise.all(promises);

        console.log("[SaveOrder] Widget order saved successfully");
    } catch (error) {
        console.error("[SaveOrder] Error saving widget order:", error);
    }
}
    // -------------------------------------------------------------------------
    // CORE DATA LOADING
    // -------------------------------------------------------------------------
    async loadData() {
        try {
            if (!this.dashboardId) {
                this.state.loading = false;
                return;
            }

            const ctx = this._getDashboardContext();

            const dashboards = await this.orm.read(
                "dashboard.dashboard",
                [this.dashboardId],
                ["name", "subtitle"],
                { context: ctx }
            );
            const dashboard = dashboards.length ? dashboards[0] : null;

            const widgets = await this.orm.searchRead(
                "dashboard.item",
                [["dashboard_id", "=", this.dashboardId]],
                [
                    "name",
                    "type",
                    "value_text",
                    "chart_type",
                    "sequence",
                    "model_id",
                    "measure_field_id",
                    "aggregation",
                    "domain",
                    "groupby_field_id",
                    "limit",
                    "date_field_id",
                ],
                { order: "sequence", context: ctx }
            );

            this.state.dashboard = dashboard;

            for (const widget of widgets) {
                this.state.widgetStylesMap[widget.id] = {
                    backgroundColor: "#1a1a2e",
                    textColor: "#ffffff",
                    borderRadius: "12",
                    padding: "20",
                    chartColor: "#3b82f6",
                    xAxisLabels: "Q1,Q2,Q3,Q4",
                    yAxisMin: "0",
                    yAxisMax: "100",
                };
                this.state.widgetRules[widget.id] = [];
                this.state.widgetEvents[widget.id] = {
                    onClick: { action: "", model: "", actionId: "", url: "" },
                    onHover: { action: "" },
                    onDoubleClick: null,
                    refreshOnClick: false,
                };
                this.state.widgetDataSources[widget.id] = {
                    type: "static",
                    values: [],
                    lastUpdated: null,
                    aiInsight: null,              // ADD THIS
                    aiInsightError: null,          // ADD THIS
                    generatingInsight: false,
                };
            }

            for (const widget of widgets) {
                await this.fetchOdooDataForWidget(widget);
            }

            const uniqueById = {};
            for (const w of widgets) uniqueById[w.id] = w;
            const uniqueWidgets = Object.values(uniqueById);

            if (this.state.currentPageId === 1) {
                this.state.pages[0].widgets = uniqueWidgets;
                this.state.widgets = uniqueWidgets;
                if (!this.state.selectedId && uniqueWidgets.length) {
                    this.state.selectedId = uniqueWidgets[0].id;
                }
            }

            this.state.loading = false;
        } catch (error) {
            console.error("[DashboardStudio] loadData error:", error);
            this.state.loading = false;
        }
    }

    async fetchOdooDataForWidget(widget) {
        if (!widget) return;

        const ctx = this._getDashboardContext();

        if ((widget.type === "kpi" || widget.type === "chart") && !widget.model_id) {
            return;
        }

        if (widget.type === "kpi") {
            try {
                const recs = await this.orm.read(
                    "dashboard.item",
                    [widget.id],
                    ["value_text"],
                    { context: ctx }
                );
                const rec = recs && recs[0] ? recs[0] : widget;
                const numeric = rec.value_text ? parseFloat(rec.value_text) : 0;

                this.state.widgetDataSources[widget.id] = {
                    type: "odoo_kpi",
                    values: [isNaN(numeric) ? 0 : numeric],
                    lastUpdated: new Date().toISOString(),
                };
                widget.value_text = rec.value_text;
            } catch (e) {
                console.error("[DashboardStudio] Error fetching KPI data:", e);
                this.state.widgetDataSources[widget.id] = {
                    type: "odoo_kpi",
                    values: [0],
                    lastUpdated: new Date().toISOString(),
                };
            }
            return;
        }

        if (widget.type === "chart") {
            try {
                const result = await this.orm.call(
                    "dashboard.item",
                    "get_chart_data",
                    [[widget.id]],
                    { context: ctx }
                );
                const labels = result.labels || [];
                const values = result.values || [];

                this.state.widgetDataSources[widget.id] = {
                    type: "odoo_chart",
                    values,
                    lastUpdated: new Date().toISOString(),
                };

                const styles = this.getWidgetStyles(widget.id);
                styles.xAxisLabels = labels.join(",");
                this.state.widgetStylesMap[widget.id] = styles;
            } catch (e) {
                console.error(
                    "[DashboardStudio] Error calling get_chart_data for widget",
                    widget.id,
                    e
                );
                this.state.widgetDataSources[widget.id] = {
                    type: "odoo_chart",
                    values: [],
                    lastUpdated: new Date().toISOString(),
                };
            }
            return;
        }

        this.state.widgetDataSources[widget.id] = {
            type: "static",
            values: [],
            lastUpdated: new Date().toISOString(),
        };
    }

    // -------------------------------------------------------------------------
    // BASIC ACTIONS / UI
    // -------------------------------------------------------------------------
    selectWidget(id) {
        this.state.selectedId = id;
    }

    switchTab(tab) {
        this.state.activeTab = tab;
    }

    togglePreview() {
        this.state.previewMode = !this.state.previewMode;
    }

    async downloadPreviewPDF() {
        if (!this.dashboardId) return;
        await this.actionService.doAction({
            type: "ir.actions.report",
            report_type: "qweb-pdf",
            report_name: "dashboard_designer.report_dashboard_template",
            context: {
                active_id: this.dashboardId,
                active_ids: [this.dashboardId],
            },
        });
    }

    updateWidgetStyle(widgetId, property, value) {
        if (!this.state.widgetStylesMap[widgetId]) {
            this.state.widgetStylesMap[widgetId] = {};
        }
        this.state.widgetStylesMap[widgetId][property] = value;
    }

    updateWidgetDataSource(widgetId, dataSource) {
        this.state.widgetDataSources[widgetId] = {
            ...this.state.widgetDataSources[widgetId],
            ...dataSource,
            lastUpdated: new Date().toISOString(),
        };
    }

    updateWidgetRules(widgetId, rules) {
        this.state.widgetRules[widgetId] = rules;
    }

    applyConditionalFormatting(widget) {
        const rules = this.getWidgetRules(widget.id);
        if (!rules || rules.length === 0) return null;

        const data = this.getWidgetData(widget.id);
        const values = data.values || [];

        for (const rule of rules) {
            for (const value of values) {
                if (this.evaluateCondition(value, rule.condition, rule.threshold)) {
                    return rule.style;
                }
            }
        }
        return null;
    }

    evaluateCondition(value, condition, threshold) {
        switch (condition) {
            case "greater_than":
                return value > threshold;
            case "less_than":
                return value < threshold;
            case "equal_to":
                return value === threshold;
            case "between":
                return value >= threshold[0] && value <= threshold[1];
            default:
                return false;
        }
    }

    updateWidgetEvents(widgetId, events) {
        this.state.widgetEvents[widgetId] = events;
    }

    handleWidgetEvent(widgetId, eventType, event) {
        const widgetEvents = this.getWidgetEvents(widgetId);
        const eventHandler = widgetEvents[eventType];

        if (!eventHandler || !eventHandler.action) return;

        switch (eventHandler.action) {
            case "open_form":
                if (eventHandler.model) this.openFormView(eventHandler.model, eventHandler.resId);
                break;
            case "open_list":
                if (eventHandler.model) this.openListView(eventHandler.model);
                break;
            case "execute_action":
                if (eventHandler.actionId) this.executeAction(eventHandler.actionId);
                break;
            case "open_url":
                if (eventHandler.url) window.open(eventHandler.url, "_blank");
                break;
            case "refresh_widget":
                this.refreshWidget(widgetId);
                break;
        }
    }

    async openFormView(model, resId) {
        if (!model) return;
        await this.actionService.doAction({
            type: "ir.actions.act_window",
            res_model: model,
            res_id: resId || null,
            views: [[false, "form"]],
            target: "new",
        });
    }

    async openListView(model) {
        if (!model) return;
        await this.actionService.doAction({
            type: "ir.actions.act_window",
            res_model: model,
            views: [[false, "list"]],
        });
    }

    async executeAction(actionId) {
        if (!actionId) return;
        await this.actionService.doAction(actionId);
    }

    async refreshWidget(widgetId) {
        const widget = this.state.widgets.find((w) => w.id === widgetId);
        if (!widget) return;
        await this.fetchOdooDataForWidget(widget);
        this.render();
    }

    async updateWidgetName(widgetId, newName) {
        try {
            await this.orm.write("dashboard.item", [widgetId], { name: newName });
            const widget = this.state.widgets.find((w) => w.id === widgetId);
            if (widget) widget.name = newName;

            const currentPage = this.state.pages.find(
                (p) => p.id === this.state.currentPageId
            );
            if (currentPage) {
                const pageWidget = currentPage.widgets.find((w) => w.id === widgetId);
                if (pageWidget) pageWidget.name = newName;
            }
            this.render();
        } catch (error) {
            console.error("[DashboardStudio] Error updating widget name:", error);
        }
    }

    async updateWidgetValue(widgetId, newValue) {
        try {
            await this.orm.write("dashboard.item", [widgetId], { value_text: newValue });

            const widget = this.state.widgets.find((w) => w.id === widgetId);
            if (widget) widget.value_text = newValue;

            const currentPage = this.state.pages.find(
                (p) => p.id === this.state.currentPageId
            );
            if (currentPage) {
                const pageWidget = currentPage.widgets.find((w) => w.id === widgetId);
                if (pageWidget) pageWidget.value_text = newValue;
            }

            await this.refreshWidget(widgetId);
        } catch (error) {
            console.error("[DashboardStudio] Error updating widget value:", error);
        }
    }

    toggleEditMode(widgetId) {
        const widget = this.state.widgets.find((w) => w.id === widgetId);
        if (widget) widget.isEditing = !widget.isEditing;
    }

    async saveWidgetTextContent(widgetId, content) {
        try {
            await this.orm.write("dashboard.item", [widgetId], { text: content });
            const widget = this.state.widgets.find((w) => w.id === widgetId);
            if (widget) {
                widget.text = content;
                widget.isEditing = false;
            }

            const currentPage = this.state.pages.find(
                (p) => p.id === this.state.currentPageId
            );
            if (currentPage) {
                const pageWidget = currentPage.widgets.find((w) => w.id === widgetId);
                if (pageWidget) {
                    pageWidget.text = content;
                    pageWidget.isEditing = false;
                }
            }
        } catch (error) {
            console.error("[DashboardStudio] Error saving text content:", error);
        }
    }

    async updateChartType(widgetId, chartType) {
        try {
            await this.orm.write("dashboard.item", [widgetId], { chart_type: chartType });
            const widget = this.state.widgets.find((w) => w.id === widgetId);
            if (widget) widget.chart_type = chartType;

            const currentPage = this.state.pages.find(
                (p) => p.id === this.state.currentPageId
            );
            if (currentPage) {
                const pageWidget = currentPage.widgets.find((w) => w.id === widgetId);
                if (pageWidget) pageWidget.chart_type = chartType;
            }
        } catch (error) {
            console.error("[DashboardStudio] Error updating chart type:", error);
        }
    }

    async addWidget(defaultName, extraVals = {}) {
        if (!this.dashboardId) return;

        const vals = Object.assign(
            {
                dashboard_id: this.dashboardId,
                name: defaultName || "New Widget",
                type: "kpi",
                sequence: this.state.widgets.length,
            },
            extraVals
        );

        const ids = await this.orm.create("dashboard.item", [vals]);
        const newId = ids && ids.length ? ids[0] : null;

        if (newId) {
            const newWidgets = await this.orm.read("dashboard.item", [newId], [
                "name",
                "type",
                "value_text",
                "chart_type",
                "sequence",
                "model_id",
                "measure_field_id",
                "aggregation",
                "domain",
                "groupby_field_id",
                "limit",
                "date_field_id",
            ]);

            if (newWidgets.length > 0) {
                const newWidget = newWidgets[0];

                this.state.widgetStylesMap[newId] = {
                    backgroundColor: "#1a1a2e",
                    textColor: "#ffffff",
                    borderRadius: "12",
                    padding: "20",
                    chartColor: "#3b82f6",
                    xAxisLabels: "Q1,Q2,Q3,Q4",
                    yAxisMin: "0",
                    yAxisMax: "100",
                };
                this.state.widgetRules[newId] = [];
                this.state.widgetEvents[newId] = {
                    onClick: { action: "", model: "", actionId: "", url: "" },
                    onHover: { action: "" },
                    onDoubleClick: null,
                    refreshOnClick: false,
                };

                const isOdooBacked =
                    newWidget.model_id &&
                    (newWidget.type === "kpi" || newWidget.type === "chart");

                if (isOdooBacked) {
                    this.state.widgetDataSources[newId] = {
                        type: newWidget.type === "kpi" ? "odoo_kpi" : "odoo_chart",
                        values: [],
                        lastUpdated: null,
                    };
                } else {
                    const demoValues =
                        newWidget.type === "chart"
                            ? [20, 45, 70, 55]
                            : newWidget.type === "kpi"
                            ? [123]
                            : [];
                    this.state.widgetDataSources[newId] = {
                        type: "static",
                        values: demoValues,
                        lastUpdated: new Date().toISOString(),
                    };
                }

                if (!this.state.widgets.find((w) => w.id === newId)) {
                    this.state.widgets.push(newWidget);
                }

                const currentPage = this.state.pages.find(
                    (p) => p.id === this.state.currentPageId
                );
                if (currentPage && !currentPage.widgets.find((w) => w.id === newId)) {
                    currentPage.widgets.push(newWidget);
                }

                this.state.selectedId = newId;

                if (isOdooBacked) {
                    await this.fetchOdooDataForWidget(newWidget);
                }
            }
        }
    }

    async addKpiCard() {
        await this.addWidget("New KPI", { type: "kpi" });
    }

    async addLineChart() {
        await this.addWidget("Line Chart", { type: "chart", chart_type: "line" });
    }

    async addBarChart() {
        await this.addWidget("Bar Chart", { type: "chart", chart_type: "bar" });
    }

    async addTextBlock() {
        await this.addWidget("Text Block", { type: "text" });
    }

    async deleteSelectedWidget() {
        const w = this.selectedWidget;
        if (!w) return;

        await this.orm.unlink("dashboard.item", [w.id]);

        delete this.state.widgetStylesMap[w.id];
        delete this.state.widgetDataSources[w.id];
        delete this.state.widgetRules[w.id];
        delete this.state.widgetEvents[w.id];

        this.state.widgets = this.state.widgets.filter((widget) => widget.id !== w.id);

        const currentPage = this.state.pages.find(
            (p) => p.id === this.state.currentPageId
        );
        if (currentPage) {
            currentPage.widgets = currentPage.widgets.filter(
                (widget) => widget.id !== w.id
            );
        }

        this.state.selectedId = null;
    }

    async openSelectedWidgetForm() {
        const w = this.selectedWidget;
        if (!w) return;

        await this.actionService.doAction({
            type: "ir.actions.act_window",
            res_model: "dashboard.item",
            res_id: w.id,
            views: [[false, "form"]],
            target: "new",
        });
        await this.loadData();
    }

    async saveWidgetChanges() {
        const w = this.selectedWidget;
        if (!w) return;

        try {
            await this.orm.write("dashboard.item", [w.id], {
                style_config: JSON.stringify(this.getWidgetStyles(w.id)),
                data_config: JSON.stringify(this.getWidgetData(w.id)),
                rules_config: JSON.stringify(this.getWidgetRules(w.id)),
                events_config: JSON.stringify(this.getWidgetEvents(w.id)),
            });
        } catch (error) {
            console.error("[DashboardStudio] Error saving widget changes:", error);
        }
    }

    onKeyup(event, callback) {
        if (event.key === "Enter") callback();
    }

    // -------------------------------------------------------------------------
    // PAGE MANAGEMENT
    // -------------------------------------------------------------------------
    addPage() {
        const maxId = this.state.pages.length
            ? Math.max(...this.state.pages.map((p) => p.id))
            : 0;
        const newId = maxId + 1;
        const newPage = {
            id: newId,
            name: `Page ${newId}`,
            active: false,
            widgets: [],
        };
        this.state.pages.push(newPage);
    }

    switchPage(pageId) {
        const currentPage = this.state.pages.find(
            (p) => p.id === this.state.currentPageId
        );
        if (currentPage) {
            currentPage.widgets = [...this.state.widgets];
        }

        this.state.pages.forEach((p) => (p.active = p.id === pageId));
        this.state.currentPageId = pageId;

        const newPage = this.state.pages.find((p) => p.id === pageId);
        this.state.widgets = newPage ? [...(newPage.widgets || [])] : [];
        this.state.selectedId = null;
    }

    renamePage(pageId, newName) {
        const page = this.state.pages.find((p) => p.id === pageId);
        if (page) page.name = newName;
    }

    deletePage(pageId) {
        if (this.state.pages.length <= 1) {
            console.warn("Cannot delete the last page");
            return;
        }

        if (this.state.currentPageId === pageId) {
            const remainingPages = this.state.pages.filter((p) => p.id !== pageId);
            if (remainingPages.length > 0) {
                this.switchPage(remainingPages[0].id);
            }
        }

        this.state.pages = this.state.pages.filter((p) => p.id !== pageId);
    }

    // -------------------------------------------------------------------------
    // GLOBAL FILTERS
    // -------------------------------------------------------------------------
    toggleGlobalFilters() {
        this.state.showGlobalFilters = !this.state.showGlobalFilters;
    }

    updateDateRange(preset) {
        this.state.globalFilters.dateRange.preset = preset;
        const today = new Date();

        switch (preset) {
            case "today": {
                this.state.globalFilters.dateRange.start = today;
                this.state.globalFilters.dateRange.end = today;
                break;
            }
            case "this_week": {
                const weekStart = new Date(today);
                weekStart.setDate(today.getDate() - today.getDay());
                this.state.globalFilters.dateRange.start = weekStart;
                this.state.globalFilters.dateRange.end = new Date();
                break;
            }
            case "this_month": {
                this.state.globalFilters.dateRange.start = new Date(
                    today.getFullYear(),
                    today.getMonth(),
                    1
                );
                this.state.globalFilters.dateRange.end = new Date();
                break;
            }
            case "this_year": {
                this.state.globalFilters.dateRange.start = new Date(
                    today.getFullYear(),
                    0,
                    1
                );
                this.state.globalFilters.dateRange.end = new Date();
                break;
            }
        }
        this.applyGlobalFilters();
    }

    async applyGlobalFilters() {
        await this.loadData();
    }

    // -------------------------------------------------------------------------
    // THEME / VERSIONING / EXPORT
    // -------------------------------------------------------------------------
    toggleThemeEditor() {
        this.state.showThemeEditor = !this.state.showThemeEditor;
    }

    updateGlobalTheme(property, value) {
        this.state.globalTheme[property] = value;
    }

    async addAdvancedChart(chartType) {
        const chartNames = {
            scatter: "Scatter Plot",
            radar: "Radar Chart",
            gauge: "Gauge Chart",
            funnel: "Funnel Chart",
            heatmap: "Heat Map",
            sankey: "Sankey Diagram",
        };
        await this.addWidget(chartNames[chartType] || "Advanced Chart", {
            type: "chart",
            chart_type: chartType,
        });
    }

    async saveVersion(description) {
        const version = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            description: description || "Auto-save",
            widgets: JSON.parse(JSON.stringify(this.state.widgets)),
            theme: JSON.parse(JSON.stringify(this.state.globalTheme)),
            widgetStylesMap: JSON.parse(JSON.stringify(this.state.widgetStylesMap)),
            widgetDataSources: JSON.parse(JSON.stringify(this.state.widgetDataSources)),
            widgetRules: JSON.parse(JSON.stringify(this.state.widgetRules)),
            widgetEvents: JSON.parse(JSON.stringify(this.state.widgetEvents)),
        };
        this.state.versions.unshift(version);

        if (this.state.versions.length > 20) {
            this.state.versions = this.state.versions.slice(0, 20);
        }
    }

    async restoreVersion(versionId) {
        const version = this.state.versions.find((v) => v.id === versionId);
        if (version) {
            this.state.widgets = JSON.parse(JSON.stringify(version.widgets));
            this.state.globalTheme = JSON.parse(JSON.stringify(version.theme));
            this.state.widgetStylesMap = JSON.parse(
                JSON.stringify(version.widgetStylesMap)
            );
            this.state.widgetDataSources = JSON.parse(
                JSON.stringify(version.widgetDataSources)
            );
            this.state.widgetRules = JSON.parse(JSON.stringify(version.widgetRules));
            this.state.widgetEvents = JSON.parse(JSON.stringify(version.widgetEvents));

            this.applyGlobalTheme();

            const currentPage = this.state.pages.find(
                (p) => p.id === this.state.currentPageId
            );
            if (currentPage) currentPage.widgets = [...this.state.widgets];
        }
    }

    toggleVersionHistory() {
        this.state.showVersionHistory = !this.state.showVersionHistory;
    }

    async exportDashboard(format) {
        switch (format) {
            case "pdf":
                await this.downloadPreviewPDF();
                break;
            case "png":
                await this.exportAsPNG();
                break;
            case "csv":
                await this.exportAsCSV();
                break;
            case "json":
                await this.exportAsJSON();
                break;
        }
    }

 // PNG EXPORT WITH html2canvas
// fromPreview: if true, capture the preview overlay; otherwise capture edit canvas
async exportAsPNG(fromPreview = false) {
    if (typeof html2canvas === "undefined") {
        alert("html2canvas library is not loaded.");
        return;
    }

    let element = null;

    if (fromPreview) {
        // PNG button in PREVIEW: capture preview overlay only
        element = document.querySelector(".dd_preview_fullscreen_overlay");
    } else {
        // PNG from EDIT mode: capture the main canvas
        element = document.querySelector(".dd_canvas");
    }

    if (!element) {
        alert("Dashboard element to capture not found.");
        return;
    }

    // Scroll page to top so nothing is clipped
    window.scrollTo(0, 0);
    if (element.scrollTop !== undefined) {
        element.scrollTop = 0;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
        // Use scrollWidth/scrollHeight so we capture full content, not just visible part
        const width = element.scrollWidth || element.clientWidth;
        const height = element.scrollHeight || element.clientHeight;

        const canvas = await html2canvas(element, {
            useCORS: true,
            backgroundColor: getComputedStyle(document.body).backgroundColor || "#0f0f23",
            scale: 2,
            logging: false,
            width,
            height,
            windowWidth: width,
            windowHeight: height,
        });

        const dataUrl = canvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = dataUrl;

        const name = this.state.dashboard && this.state.dashboard.name
            ? this.state.dashboard.name.replace(/\s+/g, "_")
            : "dashboard";
        a.download = `${name}.png`;

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch (err) {
        console.error("Error exporting dashboard as PNG:", err);
        alert("Could not generate PNG. See console for details.");
    }
}
    // -------------------------------------------------------------------------
    // ONE-CLICK SALES TEMPLATES
    // -------------------------------------------------------------------------
    async _getSalesInfo() {
        if (!this._salesInfo) {
            this._salesInfo = await this.orm.call(
                "dashboard.item",
                "get_sales_model_and_fields",
                []
            );
        }
        return this._salesInfo || {};
    }

    async addWidgetFromTemplate(templateName) {
        if (!this.dashboardId) return;

        // 1) SALES KPI – Total Sales
        if (templateName === "sales_kpi") {
            try {
                const info = await this._getSalesInfo();
                if (!info.model_id) {
                    await this.addWidget("Sales KPI", { type: "kpi" });
                    return;
                }

                const vals = {
                    dashboard_id: this.dashboardId,
                    name: "Total Sales",
                    type: "kpi",
                    sequence: this.state.widgets.length,
                    model_id: info.model_id,
                    measure_field_id: info.fields.amount_total || false,
                    aggregation: "sum",
                    domain: "[('state','in',('draft','sent','sale','done'))]",
                    date_field_id: info.fields.date_order || false,
                };

                const ids = await this.orm.create("dashboard.item", [vals]);
                const newId = ids && ids.length ? ids[0] : null;
                if (newId) {
                    const newWidgets = await this.orm.read("dashboard.item", [newId], [
                        "name",
                        "type",
                        "value_text",
                        "chart_type",
                        "sequence",
                        "model_id",
                        "measure_field_id",
                        "aggregation",
                        "domain",
                        "groupby_field_id",
                        "limit",
                        "date_field_id",
                    ]);
                    if (newWidgets.length) {
                        const newWidget = newWidgets[0];

                        this.state.widgetStylesMap[newId] = {
                            backgroundColor: "#1a1a2e",
                            textColor: "#ffffff",
                            borderRadius: "12",
                            padding: "20",
                            chartColor: "#3b82f6",
                            xAxisLabels: "Q1,Q2,Q3,Q4",
                            yAxisMin: "0",
                            yAxisMax: "100",
                        };
                        this.state.widgetRules[newId] = [];
                        this.state.widgetEvents[newId] = {
                            onClick: { action: "", model: "", actionId: "", url: "" },
                            onHover: { action: "" },
                            onDoubleClick: null,
                            refreshOnClick: false,
                        };
                        this.state.widgetDataSources[newId] = {
                            type: "odoo_kpi",
                            values: [],
                            lastUpdated: null,
                        };

                        this.state.widgets.push(newWidget);
                        const currentPage = this.state.pages.find(
                            (p) => p.id === this.state.currentPageId
                        );
                        if (currentPage) currentPage.widgets.push(newWidget);

                        this.state.selectedId = newId;
                        await this.fetchOdooDataForWidget(newWidget);
                    }
                }
            } catch (e) {
                console.error("[DashboardStudio] Error creating sales KPI:", e);
                await this.addWidget("Sales KPI", { type: "kpi" });
            }
            return;
        }

        // 2) REVENUE TREND – line chart of total sales by order date
        if (templateName === "revenue_trend") {
            try {
                const info = await this._getSalesInfo();
                if (!info.model_id) {
                    await this.addWidget("Revenue Trend", {
                        type: "chart",
                        chart_type: "line",
                    });
                    return;
                }

                const vals = {
                    dashboard_id: this.dashboardId,
                    name: "Revenue Trend",
                    type: "chart",
                    chart_type: "line",
                    sequence: this.state.widgets.length,
                    model_id: info.model_id,
                    measure_field_id: info.fields.amount_total || false,
                    aggregation: "sum",
                    domain: "[('state','in',('draft','sent','sale','done'))]",
                    groupby_field_id: info.fields.date_order || false,
                    limit: 30,
                    date_field_id: info.fields.date_order || false,
                };

                const ids = await this.orm.create("dashboard.item", [vals]);
                const newId = ids && ids.length ? ids[0] : null;
                if (newId) {
                    const newWidgets = await this.orm.read("dashboard.item", [newId], [
                        "name",
                        "type",
                        "value_text",
                        "chart_type",
                        "sequence",
                        "model_id",
                        "measure_field_id",
                        "aggregation",
                        "domain",
                        "groupby_field_id",
                        "limit",
                        "date_field_id",
                    ]);
                    if (newWidgets.length) {
                        const newWidget = newWidgets[0];

                        this.state.widgetStylesMap[newId] = {
                            backgroundColor: "#1a1a2e",
                            textColor: "#ffffff",
                            borderRadius: "12",
                            padding: "20",
                            chartColor: "#22c55e", // green
                            xAxisLabels: "",
                            yAxisMin: "0",
                            yAxisMax: "100",
                        };
                        this.state.widgetRules[newId] = [];
                        this.state.widgetEvents[newId] = {
                            onClick: { action: "", model: "", actionId: "", url: "" },
                            onHover: { action: "" },
                            onDoubleClick: null,
                            refreshOnClick: false,
                        };
                        this.state.widgetDataSources[newId] = {
                            type: "odoo_chart",
                            values: [],
                            lastUpdated: null,
                        };

                        this.state.widgets.push(newWidget);
                        const currentPage = this.state.pages.find(
                            (p) => p.id === this.state.currentPageId
                        );
                        if (currentPage) currentPage.widgets.push(newWidget);

                        this.state.selectedId = newId;
                        await this.fetchOdooDataForWidget(newWidget);
                    }
                }
            } catch (e) {
                console.error("[DashboardStudio] Error creating revenue trend chart:", e);
                await this.addWidget("Revenue Trend", {
                    type: "chart",
                    chart_type: "line",
                });
            }
            return;
        }

        // 3) TOP PRODUCTS – here: Sales by Customer (bar chart)
        if (templateName === "top_products") {
            try {
                const info = await this._getSalesInfo();
                if (!info.model_id) {
                    await this.addWidget("Top Products", {
                        type: "chart",
                        chart_type: "bar",
                    });
                    return;
                }

                const partnerFields = await this.orm.searchRead(
                    "ir.model.fields",
                    [
                        ["model_id", "=", info.model_id],
                        ["name", "=", "partner_id"],
                    ],
                    ["id", "name"]
                );
                const partnerFieldId = partnerFields.length ? partnerFields[0].id : false;

                const vals = {
                    dashboard_id: this.dashboardId,
                    name: "Sales by Customer",
                    type: "chart",
                    chart_type: "bar",
                    sequence: this.state.widgets.length,
                    model_id: info.model_id,
                    measure_field_id: info.fields.amount_total || false,
                    aggregation: "sum",
                    domain: "[('state','in',('draft','sent','sale','done'))]",
                    groupby_field_id: partnerFieldId || false,
                    limit: 10,
                    date_field_id: info.fields.date_order || false,
                };

                const ids = await this.orm.create("dashboard.item", [vals]);
                const newId = ids && ids.length ? ids[0] : null;
                if (newId) {
                    const newWidgets = await this.orm.read("dashboard.item", [newId], [
                        "name",
                        "type",
                        "value_text",
                        "chart_type",
                        "sequence",
                        "model_id",
                        "measure_field_id",
                        "aggregation",
                        "domain",
                        "groupby_field_id",
                        "limit",
                        "date_field_id",
                    ]);
                    if (newWidgets.length) {
                        const newWidget = newWidgets[0];

                        this.state.widgetStylesMap[newId] = {
                            backgroundColor: "#1a1a2e",
                            textColor: "#ffffff",
                            borderRadius: "12",
                            padding: "20",
                            chartColor: "#f97316", // orange
                            xAxisLabels: "",
                            yAxisMin: "0",
                            yAxisMax: "100",
                        };
                        this.state.widgetRules[newId] = [];
                        this.state.widgetEvents[newId] = {
                            onClick: { action: "", model: "", actionId: "", url: "" },
                            onHover: { action: "" },
                            onDoubleClick: null,
                            refreshOnClick: false,
                        };
                        this.state.widgetDataSources[newId] = {
                            type: "odoo_chart",
                            values: [],
                            lastUpdated: null,
                        };

                        this.state.widgets.push(newWidget);
                        const currentPage = this.state.pages.find(
                            (p) => p.id === this.state.currentPageId
                        );
                        if (currentPage) currentPage.widgets.push(newWidget);

                        this.state.selectedId = newId;
                        await this.fetchOdooDataForWidget(newWidget);
                    }
                }
            } catch (e) {
                console.error("[DashboardStudio] Error creating top products chart:", e);
                await this.addWidget("Top Products", {
                    type: "chart",
                    chart_type: "bar",
                });
            }
            return;
        }

        // Other templates keep default behavior (demo widgets)
        if (templateName === "conversion_funnel") {
            await this.addWidget("Conversion Funnel", {
                type: "chart",
                chart_type: "funnel",
            });
            return;
        }
        if (templateName === "performance_gauge") {
            await this.addWidget("Performance", {
                type: "chart",
                chart_type: "gauge",
            });
            return;
        }
    }

    willUnmount() {
        if (this.state.dataRefreshInterval) {
            clearInterval(this.state.dataRefreshInterval);
        }
    }

    // -------------------------------------------------------------------------
    // HELPER FUNCTIONS FOR TEMPLATE
    // -------------------------------------------------------------------------
    normalizeToYAxis(widgetId, value) {
        const styles = this.getWidgetStyles(widgetId);
        let min = parseFloat(styles.yAxisMin ?? "0");
        let max = parseFloat(styles.yAxisMax ?? "100");
        if (isNaN(min)) min = 0;
        if (isNaN(max)) max = 100;
        if (max === min) max = min + 1;
        const ratio = (value - min) / (max - min);
        return Math.max(0, Math.min(1, ratio));
    }

    getYAxisTicks(widgetId) {
        const styles = this.getWidgetStyles(widgetId);
        let min = parseFloat(styles.yAxisMin ?? "0");
        let max = parseFloat(styles.yAxisMax ?? "100");
        if (isNaN(min)) min = 0;
        if (isNaN(max)) max = 100;

        let from = Math.min(min, max);
        let to = Math.max(min, max);

        const steps = 4;
        const step = (to - from) / steps || 1;
        const ticks = [];
        for (let i = 0; i <= steps; i++) {
            ticks.push(Math.round(from + i * step));
        }
        return ticks.reverse();
    }

    getWidgetCardStyle(widgetId) {
        const styles = this.getWidgetStyles(widgetId);
        const conditionalStyle = this.applyConditionalFormatting({ id: widgetId });

        let styleStr = `background-color: ${styles.backgroundColor}; color: ${styles.textColor}; border-radius: ${styles.borderRadius}px; padding: ${styles.padding}px;`;

        if (conditionalStyle) {
            if (conditionalStyle.backgroundColor) {
                styleStr += `background-color: ${conditionalStyle.backgroundColor};`;
            }
            if (conditionalStyle.color) {
                styleStr += `color: ${conditionalStyle.color};`;
            }
        }

        return styleStr;
    }

    getLineChartPoints(widgetId) {
        const data = this.getWidgetData(widgetId);
        const values = data.values || [];
        if (!values.length) return "";
        const count = values.length;
        return values
            .map((value, index) => {
                const x = count === 1 ? 50 : (index / (count - 1)) * 100;
                const numeric = isNaN(value) ? 0 : value;
                const norm = this.normalizeToYAxis(widgetId, numeric);
                const y = 100 - norm * 80;
                return `${x},${y}`;
            })
            .join(" ");
    }

    getScatterPoints(widgetId) {
        const data = this.getWidgetData(widgetId);
        const values = data.values || [];
        const count = values.length || 1;
        return values.map((value, index) => {
            const x = ((index + 0.5) / count) * 100;
            const numeric = isNaN(value) ? 0 : value;
            const norm = this.normalizeToYAxis(widgetId, numeric);
            const y = 100 - norm * 80;
            return { x, y };
        });
    }

    getRadarPoints(widgetId) {
        const data = this.getWidgetData(widgetId);
        const values = data.values || [];
        if (!values.length) return "";
        const angleStep = (Math.PI * 2) / values.length;

        return values
            .map((value, index) => {
                const angle = angleStep * index - Math.PI / 2;
                const numeric = isNaN(value) ? 0 : value;
                const norm = this.normalizeToYAxis(widgetId, numeric);
                const distance = norm * 40;
                const x = 50 + distance * Math.cos(angle);
                const y = 50 + distance * Math.sin(angle);
                return `${x},${y}`;
            })
            .join(" ");
    }

    getGaugeMid(widgetId) {
        const styles = this.getWidgetStyles(widgetId);
        let min = parseFloat(styles.yAxisMin ?? "0");
        let max = parseFloat(styles.yAxisMax ?? "100");
        if (isNaN(min)) min = 0;
        if (isNaN(max)) max = 100;
        return Math.round((min + max) / 2);
    }

    getGaugeArc(widgetId) {
        const data = this.getWidgetData(widgetId);
        let value = data.values && data.values.length ? data.values[0] : 0;
        const numeric = isNaN(value) ? 0 : value;
        const norm = this.normalizeToYAxis(widgetId, numeric);

        const angle = 180 - norm * 180;
        const rad = (angle * Math.PI) / 180;
        const endX = 50 + 40 * Math.cos(rad);
        const endY = 50 - 40 * Math.sin(rad);

        const largeArc = angle > 180 ? 1 : 0;
        return `M 10 50 A 40 40 0 ${largeArc} 1 ${endX} ${endY}`;
    }

    getGaugeNeedle(widgetId) {
        const data = this.getWidgetData(widgetId);
        let value = data.values && data.values.length ? data.values[0] : 0;
        const numeric = isNaN(value) ? 0 : value;
        const norm = this.normalizeToYAxis(widgetId, numeric);

        const angle = 180 - norm * 180;
        const rad = (angle * Math.PI) / 180;
        const endX = 50 + 35 * Math.cos(rad);
        const endY = 50 - 35 * Math.sin(rad);

        return {
            x1: 50,
            y1: 50,
            x2: endX,
            y2: endY,
        };
    }

    getFunnelPath(widgetId, index, value) {
        const numeric = isNaN(value) ? 0 : value;
        const norm = this.normalizeToYAxis(widgetId, numeric);

        const topWidth = 80;
        const bottomWidth = 20;
        const height = 20;
        const verticalOffset = index * height;

        const width = bottomWidth + (topWidth - bottomWidth) * norm;
        const leftX = (100 - width) / 2;
        const rightX = leftX + width;

        const bottomLeft = (100 - bottomWidth) / 2;
        const bottomRight = bottomLeft + bottomWidth;

        return `M ${leftX} ${verticalOffset} L ${rightX} ${verticalOffset} L ${bottomRight} ${
            verticalOffset + height
        } L ${bottomLeft} ${verticalOffset + height} Z`;
    }

    getHeatmapData(widgetId) {
        const data = this.getWidgetData(widgetId);
        const values = data.values || [];

        const rows = [];
        for (let i = 0; i < 3; i++) {
            const row = [];
            for (let j = 0; j < 4; j++) {
                const raw = values[i * 4 + j];
                let norm;
                if (raw !== undefined) {
                    const numeric = isNaN(raw) ? 0 : raw;
                    norm = this.normalizeToYAxis(widgetId, numeric);
                } else {
                    norm = Math.random();
                }
                row.push(norm);
            }
            rows.push(row);
        }
        return rows;
    }

    getSankeyLayout(widgetId) {
        const data = this.getWidgetData(widgetId);
        const values = (data.values || []).filter((v) => !isNaN(v) && v > 0);
        if (!values.length) {
            return { nodes: [], links: [] };
        }
        const total = values.reduce((a, b) => a + b, 0) || 1;
        const maxVal = Math.max(...values, 1);

        const nodes = [];
        const links = [];
        let currentY = 5;

        values.forEach((value, idx) => {
            const height = (value / total) * 50;
            const leftNode = {
                id: `L${idx}`,
                x: 5,
                y: currentY,
                width: 8,
                height: height,
                opacity: 0.7,
            };
            const rightNode = {
                id: `R${idx}`,
                x: 87,
                y: currentY,
                width: 8,
                height: height,
                opacity: 0.7,
            };
            nodes.push(leftNode, rightNode);

            const x1 = leftNode.x + leftNode.width;
            const y1 = leftNode.y + leftNode.height / 2;
            const x2 = rightNode.x;
            const y2 = rightNode.y + rightNode.height / 2;
            const width = Math.max(2, (value / maxVal) * 6);

            const path = `M ${x1} ${y1} C 50 ${y1}, 50 ${y2}, ${x2} ${y2}`;
            links.push({
                id: `L${idx}-R${idx}`,
                path,
                width,
                opacity: 0.5,
            });

            currentY += height + 3;
        });

        return { nodes, links };
    }

    formatKpiValue(value) {
        if (typeof value !== "number") {
            value = parseFloat(value);
        }
        if (isNaN(value)) return "0";
        return value.toLocaleString();
    }

    formatTime(timestamp) {
        if (!timestamp) return "";
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) return "Just now";
        if (diffMins < 60) return `${diffMins} min ago`;

        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;

        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    }

    updateRule(widgetId, ruleIndex, property, value) {
        if (!this.state.widgetRules[widgetId]) {
            this.state.widgetRules[widgetId] = [];
        }

        if (!this.state.widgetRules[widgetId][ruleIndex]) {
            this.state.widgetRules[widgetId][ruleIndex] = {
                condition: "greater_than",
                threshold: 50,
                style: {
                    backgroundColor: "#22c55e",
                    color: "#ffffff",
                },
            };
        }

        if (property.includes(".")) {
            const [parent, child] = property.split(".");
            this.state.widgetRules[widgetId][ruleIndex][parent][child] = value;
        } else {
            this.state.widgetRules[widgetId][ruleIndex][property] = value;
        }
    }

    removeRule(widgetId, ruleIndex) {
        if (!this.state.widgetRules[widgetId]) return;
        this.state.widgetRules[widgetId].splice(ruleIndex, 1);
    }

    addRule(widgetId) {
        if (!this.state.widgetRules[widgetId]) {
            this.state.widgetRules[widgetId] = [];
        }

        this.state.widgetRules[widgetId].push({
            condition: "greater_than",
            threshold: 50,
            style: {
                backgroundColor: "#22c55e",
                color: "#ffffff",
            },
        });
    }

    updateEvent(widgetId, eventType, property, value) {
        if (!this.state.widgetEvents[widgetId]) {
            this.state.widgetEvents[widgetId] = {
                onClick: { action: "", model: "", actionId: "", url: "" },
                onHover: { action: "" },
                onDoubleClick: null,
                refreshOnClick: false,
            };
        }

        if (!this.state.widgetEvents[widgetId][eventType]) {
            if (eventType === "onClick") {
                this.state.widgetEvents[widgetId][eventType] = {
                    action: "",
                    model: "",
                    actionId: "",
                    url: "",
                };
            } else if (eventType === "onHover") {
                this.state.widgetEvents[widgetId][eventType] = { action: "" };
            } else {
                this.state.widgetEvents[widgetId][eventType] = {};
            }
        }

        if (property) {
            this.state.widgetEvents[widgetId][eventType][property] = value;
        } else {
            this.state.widgetEvents[widgetId][eventType] = value;
        }
    }
}

DashboardStudio.template = "dashboard_designer.DashboardStudio";
actionRegistry.add("dashboard_studio", DashboardStudio);