#include "model.hpp"

namespace baseline {
class Widget final : public Surface {
public:
    std::string render() const override {
        return std::to_string(renameMe(2));
    }
};
}
