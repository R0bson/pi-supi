package client;

import example.Model;

public final class Entry {
    public static void main(String[] args) {
        int value = Model.renameMe(3);
        int knownError = 1 + "wrong";
        System.out.println(value + knownError);
    }
}
