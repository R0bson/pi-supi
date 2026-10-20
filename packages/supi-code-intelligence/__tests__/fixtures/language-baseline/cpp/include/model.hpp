#pragma once
#include <string>

namespace baseline {
class Surface {
public:
    virtual ~Surface() = default;
    virtual std::string render() const = 0;
};

int renameMe(int value);
}
