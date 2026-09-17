from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

from second_brain.config import Settings

log = logging.getLogger(__name__)


class AnalysisError(RuntimeError):
    """Raised when the model could not produce a usable answer for one item."""


@dataclass
class Completion:
    text: str
    input_tokens: int
    output_tokens: int
    cost_usd: float

    def json(self) -> dict[str, Any]:
        return json.loads(self.text)


class ClaudeClient:
    def __init__(self, settings: Settings) -> None:
        try:
            import anthropic
        except ImportError as error:
            raise RuntimeError(
                "anthropic is not installed; run pip install -r requirements.txt"
            ) from error

        if not settings.api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set; copy .env.example to .env")

        self._anthropic = anthropic
        self._client = anthropic.Anthropic(api_key=settings.api_key)
        self.model = settings.model
        self._input_price, self._output_price = settings.price_per_million()

    def _cost(self, input_tokens: int, output_tokens: int) -> float:
        return (
            input_tokens * self._input_price + output_tokens * self._output_price
        ) / 1_000_000

    def complete(
        self,
        system: str,
        content: list[dict] | str,
        schema: dict | None = None,
        max_tokens: int = 4000,
        effort: str = "medium",
    ) -> Completion:
        anthropic = self._anthropic
        output_config: dict[str, Any] = {"effort": effort}
        if schema is not None:
            output_config["format"] = {"type": "json_schema", "schema": schema}

        try:
            response = self._client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": content}],
                output_config=output_config,
            )
        except anthropic.BadRequestError as error:
            raise AnalysisError(f"bad request: {error.message}") from error
        except anthropic.AuthenticationError as error:
            raise RuntimeError("ANTHROPIC_API_KEY was rejected") from error
        except anthropic.RateLimitError as error:
            raise AnalysisError("rate limited by the Claude API") from error
        except anthropic.APIStatusError as error:
            raise AnalysisError(f"API error {error.status_code}: {error.message}") from error
        except anthropic.APIConnectionError as error:
            raise AnalysisError(f"network error: {error}") from error

        if response.stop_reason == "refusal":
            detail = getattr(response.stop_details, "explanation", "no explanation")
            raise AnalysisError(f"model declined the request: {detail}")

        text = next((block.text for block in response.content if block.type == "text"), "")
        if not text:
            raise AnalysisError("model returned no text content")

        usage = response.usage
        return Completion(
            text=text,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cost_usd=self._cost(usage.input_tokens, usage.output_tokens),
        )
