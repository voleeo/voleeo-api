#![allow(deprecated)]
use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
use objc2::{msg_send, sel};
use objc2_foundation::NSRect;
use std::ffi::{c_void, CString};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{Emitter, Manager, Runtime, Window};

/// Raw Objective-C object pointer (`id`).
type Id = *mut AnyObject;

struct UnsafeWindowHandle(*mut c_void);
unsafe impl Send for UnsafeWindowHandle {}
unsafe impl Sync for UnsafeWindowHandle {}

const WINDOW_CONTROL_PAD_X: f64 = 13.0;
const WINDOW_CONTROL_PAD_Y: f64 = 13.0;
const TITLEBAR_EXTRA_HEIGHT: f64 = 4.0;
// NSWindowStyleMask::NSFullSizeContentViewWindowMask
const NS_FULL_SIZE_CONTENT_VIEW_WINDOW_MASK: u64 = 1 << 15;
// NSWindowTitleVisibility::NSWindowTitleHidden
const NS_WINDOW_TITLE_HIDDEN: i64 = 1;
// NSWindowButton variants
const NS_WINDOW_CLOSE_BUTTON: u64 = 0;
const NS_WINDOW_MINIATURIZE_BUTTON: u64 = 1;
const NS_WINDOW_ZOOM_BUTTON: u64 = 2;

#[derive(Debug)]
struct WindowState<R: Runtime> {
    window: Window<R>,
}

fn setup_overlay_titlebar(ns_window: Id) {
    unsafe {
        let _: () = msg_send![ns_window, setTitlebarAppearsTransparent: true];
        let _: () = msg_send![ns_window, setTitleVisibility: NS_WINDOW_TITLE_HIDDEN];
        let style: u64 = msg_send![ns_window, styleMask];
        let _: () =
            msg_send![ns_window, setStyleMask: style | NS_FULL_SIZE_CONTENT_VIEW_WINDOW_MASK];
    }
}

fn position_traffic_lights(ns_window_handle: UnsafeWindowHandle, x: f64, y: f64) {
    let ns_window = ns_window_handle.0 as Id;
    unsafe {
        let close: Id = msg_send![ns_window, standardWindowButton: NS_WINDOW_CLOSE_BUTTON];
        let miniaturize: Id =
            msg_send![ns_window, standardWindowButton: NS_WINDOW_MINIATURIZE_BUTTON];
        let zoom: Id = msg_send![ns_window, standardWindowButton: NS_WINDOW_ZOOM_BUTTON];

        let close_rect: NSRect = msg_send![close, frame];
        let button_height = close_rect.size.height;

        let close_superview: Id = msg_send![close, superview];
        let title_bar_container_view: Id = msg_send![close_superview, superview];

        static DEFAULT_TITLEBAR_HEIGHT: OnceLock<f64> = OnceLock::new();
        let default_height = match DEFAULT_TITLEBAR_HEIGHT.get() {
            Some(h) => *h,
            None => {
                let rect: NSRect = msg_send![title_bar_container_view, frame];
                if rect.size.height < 10.0 {
                    return;
                }
                let _ = DEFAULT_TITLEBAR_HEIGHT.set(rect.size.height);
                rect.size.height
            }
        };

        let desired = button_height + y;
        let title_bar_frame_height = if desired > default_height {
            desired
        } else {
            default_height + TITLEBAR_EXTRA_HEIGHT
        };

        let window_rect: NSRect = msg_send![ns_window, frame];
        let mut title_bar_rect: NSRect = msg_send![title_bar_container_view, frame];
        title_bar_rect.size.height = title_bar_frame_height;
        title_bar_rect.origin.y = window_rect.size.height - title_bar_frame_height;
        let _: () = msg_send![title_bar_container_view, setFrame: title_bar_rect];

        let mini_rect: NSRect = msg_send![miniaturize, frame];
        let close_origin_rect: NSRect = msg_send![close, frame];
        let space_between = mini_rect.origin.x - close_origin_rect.origin.x;

        for (i, button) in [close, miniaturize, zoom].into_iter().enumerate() {
            let mut rect: NSRect = msg_send![button, frame];
            rect.origin.x = x + (i as f64 * space_between);
            let _: () = msg_send![button, setFrameOrigin: rect.origin];
        }
    }
}

fn with_window_state<R: Runtime, F: FnOnce(&mut WindowState<R>) -> T, T>(
    this: &AnyObject,
    func: F,
) {
    let ptr = unsafe {
        let x: *mut c_void = *this.get_ivar::<*mut c_void>("app_box");
        &mut *(x as *mut WindowState<R>)
    };
    func(ptr);
}

fn super_delegate(this: &AnyObject) -> Id {
    unsafe { *this.get_ivar::<Id>("super_delegate") }
}

/// The NSWindow that posted this delegate notification (`[notification object]`).
///
/// Source the window from the notification, never via `Window::ns_window()`:
/// closing a window drops the tao window *while Tauri holds `windows` borrowed
/// mutably*, and the close synchronously fires `windowDidBecomeKey:` on the next
/// window. Re-entering Tauri there double-borrows that RefCell and aborts the app.
unsafe fn notification_window(notification: Id) -> *mut c_void {
    let ns_window: Id = msg_send![notification, object];
    ns_window as *mut c_void
}

extern "C" fn on_window_should_close(this: &AnyObject, _cmd: Sel, sender: Id) -> Bool {
    unsafe { msg_send![super_delegate(this), windowShouldClose: sender] }
}
extern "C" fn on_window_will_close(this: &AnyObject, _cmd: Sel, notification: Id) {
    unsafe {
        let _: () = msg_send![super_delegate(this), windowWillClose: notification];
    }
}
extern "C" fn on_window_did_resize(this: &AnyObject, _cmd: Sel, notification: Id) {
    unsafe {
        position_traffic_lights(
            UnsafeWindowHandle(notification_window(notification)),
            WINDOW_CONTROL_PAD_X,
            WINDOW_CONTROL_PAD_Y,
        );
        let _: () = msg_send![super_delegate(this), windowDidResize: notification];
    }
}
extern "C" fn on_window_did_move(this: &AnyObject, _cmd: Sel, notification: Id) {
    unsafe {
        let _: () = msg_send![super_delegate(this), windowDidMove: notification];
    }
}
extern "C" fn on_window_did_change_backing_properties(
    this: &AnyObject,
    _cmd: Sel,
    notification: Id,
) {
    unsafe {
        let _: () = msg_send![super_delegate(this), windowDidChangeBackingProperties: notification];
    }
}
extern "C" fn on_window_did_become_key(this: &AnyObject, _cmd: Sel, notification: Id) {
    unsafe {
        position_traffic_lights(
            UnsafeWindowHandle(notification_window(notification)),
            WINDOW_CONTROL_PAD_X,
            WINDOW_CONTROL_PAD_Y,
        );
        let _: () = msg_send![super_delegate(this), windowDidBecomeKey: notification];
    }
}
extern "C" fn on_window_did_resign_key(this: &AnyObject, _cmd: Sel, notification: Id) {
    unsafe {
        let _: () = msg_send![super_delegate(this), windowDidResignKey: notification];
    }
}

extern "C" fn on_dragging_entered(this: &AnyObject, _cmd: Sel, notification: Id) -> Bool {
    unsafe { msg_send![super_delegate(this), draggingEntered: notification] }
}
extern "C" fn on_prepare_for_drag_operation(this: &AnyObject, _cmd: Sel, notification: Id) -> Bool {
    unsafe { msg_send![super_delegate(this), prepareForDragOperation: notification] }
}
extern "C" fn on_perform_drag_operation(this: &AnyObject, _cmd: Sel, sender: Id) -> Bool {
    unsafe { msg_send![super_delegate(this), performDragOperation: sender] }
}
extern "C" fn on_conclude_drag_operation(this: &AnyObject, _cmd: Sel, notification: Id) {
    unsafe {
        let _: () = msg_send![super_delegate(this), concludeDragOperation: notification];
    }
}
extern "C" fn on_dragging_exited(this: &AnyObject, _cmd: Sel, notification: Id) {
    unsafe {
        let _: () = msg_send![super_delegate(this), draggingExited: notification];
    }
}

extern "C" fn on_window_will_use_full_screen_presentation_options(
    this: &AnyObject,
    _cmd: Sel,
    window: Id,
    proposed_options: usize,
) -> usize {
    unsafe {
        msg_send![
            super_delegate(this),
            window: window,
            willUseFullScreenPresentationOptions: proposed_options
        ]
    }
}
extern "C" fn on_window_did_enter_full_screen<R: Runtime>(
    this: &AnyObject,
    _cmd: Sel,
    notification: Id,
) {
    with_window_state(this, |state: &mut WindowState<R>| {
        state
            .window
            .emit("did-enter-fullscreen", ())
            .expect("Failed to emit event");
    });
    unsafe {
        let _: () = msg_send![super_delegate(this), windowDidEnterFullScreen: notification];
    }
}
extern "C" fn on_window_will_enter_full_screen<R: Runtime>(
    this: &AnyObject,
    _cmd: Sel,
    notification: Id,
) {
    with_window_state(this, |state: &mut WindowState<R>| {
        state
            .window
            .emit("will-enter-fullscreen", ())
            .expect("Failed to emit event");
    });
    unsafe {
        let _: () = msg_send![super_delegate(this), windowWillEnterFullScreen: notification];
    }
}
extern "C" fn on_window_did_exit_full_screen<R: Runtime>(
    this: &AnyObject,
    _cmd: Sel,
    notification: Id,
) {
    with_window_state(this, |state: &mut WindowState<R>| {
        state
            .window
            .emit("did-exit-fullscreen", ())
            .expect("Failed to emit event");
    });
    unsafe {
        position_traffic_lights(
            UnsafeWindowHandle(notification_window(notification)),
            WINDOW_CONTROL_PAD_X,
            WINDOW_CONTROL_PAD_Y,
        );
        let _: () = msg_send![super_delegate(this), windowDidExitFullScreen: notification];
    }
}
extern "C" fn on_window_will_exit_full_screen<R: Runtime>(
    this: &AnyObject,
    _cmd: Sel,
    notification: Id,
) {
    with_window_state(this, |state: &mut WindowState<R>| {
        state
            .window
            .emit("will-exit-fullscreen", ())
            .expect("Failed to emit event");
    });
    unsafe {
        let _: () = msg_send![super_delegate(this), windowWillExitFullScreen: notification];
    }
}
extern "C" fn on_window_did_fail_to_enter_full_screen(this: &AnyObject, _cmd: Sel, window: Id) {
    unsafe {
        let _: () = msg_send![super_delegate(this), windowDidFailToEnterFullScreen: window];
    }
}

extern "C" fn on_effective_appearance_did_change(this: &AnyObject, _cmd: Sel, notification: Id) {
    unsafe {
        let _: () = msg_send![super_delegate(this), effectiveAppearanceDidChange: notification];
    }
}
extern "C" fn on_effective_appearance_did_changed_on_main_thread(
    this: &AnyObject,
    _cmd: Sel,
    notification: Id,
) {
    unsafe {
        let _: () = msg_send![super_delegate(this), effectiveAppearanceDidChangedOnMainThread: notification];
    }
}

// Builds a fresh NSObject subclass that conforms to NSWindowDelegate, forwarding
// every message to Tauri's original delegate while intercepting the few we care
// about (traffic-light repositioning + fullscreen events). A unique name per
// window keeps `objc_allocateClassPair` from colliding on re-registration.
fn build_delegate_class<R: Runtime>(name: &str) -> &'static AnyClass {
    let superclass = AnyClass::get(c"NSObject").expect("NSObject must exist");
    let cname = CString::new(name).expect("delegate name has no interior nul");
    let mut builder =
        ClassBuilder::new(&cname, superclass).expect("delegate class name already registered");

    builder.add_ivar::<*mut c_void>(c"app_box");
    builder.add_ivar::<Id>(c"super_delegate");

    unsafe {
        builder.add_method(
            sel!(windowShouldClose:),
            on_window_should_close as extern "C" fn(_, _, _) -> _,
        );
        builder.add_method(
            sel!(windowWillClose:),
            on_window_will_close as extern "C" fn(_, _, _),
        );
        builder.add_method(
            sel!(windowDidResize:),
            on_window_did_resize as extern "C" fn(_, _, _),
        );
        builder.add_method(
            sel!(windowDidMove:),
            on_window_did_move as extern "C" fn(_, _, _),
        );
        builder.add_method(
            sel!(windowDidChangeBackingProperties:),
            on_window_did_change_backing_properties as extern "C" fn(_, _, _),
        );
        builder.add_method(
            sel!(windowDidBecomeKey:),
            on_window_did_become_key as extern "C" fn(_, _, _),
        );
        builder.add_method(
            sel!(windowDidResignKey:),
            on_window_did_resign_key as extern "C" fn(_, _, _),
        );
        builder.add_method(
            sel!(draggingEntered:),
            on_dragging_entered as extern "C" fn(_, _, _) -> _,
        );
        builder.add_method(
            sel!(prepareForDragOperation:),
            on_prepare_for_drag_operation as extern "C" fn(_, _, _) -> _,
        );
        builder.add_method(
            sel!(performDragOperation:),
            on_perform_drag_operation as extern "C" fn(_, _, _) -> _,
        );
        builder.add_method(
            sel!(concludeDragOperation:),
            on_conclude_drag_operation as extern "C" fn(_, _, _),
        );
        builder.add_method(
            sel!(draggingExited:),
            on_dragging_exited as extern "C" fn(_, _, _),
        );
        builder.add_method(
            sel!(window:willUseFullScreenPresentationOptions:),
            on_window_will_use_full_screen_presentation_options as extern "C" fn(_, _, _, _) -> _,
        );
        builder.add_method(
            sel!(windowDidEnterFullScreen:),
            on_window_did_enter_full_screen::<R> as extern "C" fn(_, _, _),
        );
        builder.add_method(
            sel!(windowWillEnterFullScreen:),
            on_window_will_enter_full_screen::<R> as extern "C" fn(_, _, _),
        );
        builder.add_method(
            sel!(windowDidExitFullScreen:),
            on_window_did_exit_full_screen::<R> as extern "C" fn(_, _, _),
        );
        builder.add_method(
            sel!(windowWillExitFullScreen:),
            on_window_will_exit_full_screen::<R> as extern "C" fn(_, _, _),
        );
        builder.add_method(
            sel!(windowDidFailToEnterFullScreen:),
            on_window_did_fail_to_enter_full_screen as extern "C" fn(_, _, _),
        );
        builder.add_method(
            sel!(effectiveAppearanceDidChange:),
            on_effective_appearance_did_change as extern "C" fn(_, _, _),
        );
        builder.add_method(
            sel!(effectiveAppearanceDidChangedOnMainThread:),
            on_effective_appearance_did_changed_on_main_thread as extern "C" fn(_, _, _),
        );
    }

    builder.register()
}

pub fn setup_traffic_light_positioner<R: Runtime>(window: &Window<R>) {
    use rand::distr::Alphanumeric;
    use rand::Rng;

    let ns_win_ptr = window.ns_window().expect("Failed to get ns_window");
    setup_overlay_titlebar(ns_win_ptr as Id);
    position_traffic_lights(
        UnsafeWindowHandle(ns_win_ptr),
        WINDOW_CONTROL_PAD_X,
        WINDOW_CONTROL_PAD_Y,
    );

    unsafe {
        let ns_win = ns_win_ptr as Id;
        let current_delegate: Id = msg_send![ns_win, delegate];

        let app_state = WindowState {
            window: window.clone(),
        };
        let app_box = Box::into_raw(Box::new(app_state)) as *mut c_void;
        let random_str: String = rand::rng()
            .sample_iter(&Alphanumeric)
            .take(20)
            .map(char::from)
            .collect();
        let delegate_name = format!("windowDelegate_{}_{}", window.label(), random_str);

        let cls = build_delegate_class::<R>(&delegate_name);
        let delegate: Id = msg_send![cls, alloc];
        let delegate: Id = msg_send![delegate, init];

        // `delegate` keeps +1 from alloc/init and is never released — it must
        // outlive the window, whose `delegate` property only holds it weakly.
        let d = &mut *delegate;
        *d.get_mut_ivar::<*mut c_void>("app_box") = app_box;
        *d.get_mut_ivar::<Id>("super_delegate") = current_delegate;

        let _: () = msg_send![ns_win, setDelegate: delegate];
    }

    let app = window.app_handle().clone();
    let win = window.clone();
    std::thread::spawn(move || {
        for delay in [50u64, 150, 350] {
            std::thread::sleep(Duration::from_millis(delay));
            let w = win.clone();
            let _ = app.run_on_main_thread(move || {
                if let Ok(id) = w.ns_window() {
                    position_traffic_lights(
                        UnsafeWindowHandle(id),
                        WINDOW_CONTROL_PAD_X,
                        WINDOW_CONTROL_PAD_Y,
                    );
                }
            });
        }
    });
}
