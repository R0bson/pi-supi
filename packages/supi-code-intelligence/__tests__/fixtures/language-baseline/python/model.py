from abc import ABC, abstractmethod


class Surface(ABC):
    @abstractmethod
    def render(self) -> str:
        raise NotImplementedError


def rename_me(value: int) -> int:
    return value + 1
