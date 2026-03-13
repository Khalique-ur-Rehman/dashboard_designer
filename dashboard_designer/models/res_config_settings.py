# dashboard_designer/models/res_config_settings.py

from odoo import models, fields


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    dashboard_ai_api_key = fields.Char(
        string="AI API Key",
        config_parameter='dashboard_designer.ai_api_key',
        help="API key for AI service (e.g., OpenAI API key)"
    )

    dashboard_ai_endpoint = fields.Char(
        string="AI API Endpoint",
        config_parameter='dashboard_designer.ai_endpoint',
        default='https://api.openai.com/v1/chat/completions',
        help="API endpoint URL for AI service"
    )

    dashboard_ai_model = fields.Char(
        string="AI Model",
        config_parameter='dashboard_designer.ai_model',
        default='gpt-4o-mini',
        help="AI model to use (e.g., gpt-4o-mini, gpt-3.5-turbo)"
    )