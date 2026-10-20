package example;

public final class Widget implements Surface {
    @Override
    public String render() {
        return Integer.toString(Model.renameMe(2));
    }
}
