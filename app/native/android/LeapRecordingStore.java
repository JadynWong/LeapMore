package com.leapmore.app;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

final class LeapRecordingStore extends SQLiteOpenHelper {
    LeapRecordingStore(Context context) { super(context, "leapmore-phone.db", null, 1); }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE locations(vehicle TEXT NOT NULL, at INTEGER NOT NULL, lat REAL, lon REAL, speed REAL, PRIMARY KEY(vehicle, at)) WITHOUT ROWID");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {}

    void clear(String vehicle) { getWritableDatabase().delete("locations", "vehicle=?", new String[]{vehicle}); }
}
