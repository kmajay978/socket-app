/*eslint-disable */
var moment = require("moment");
var job = require('./jobs');
var socket_id = null;
var usersConnected = {};
var videoCallState;
var video_live_hosts = [];

var startTimeLiveVideoCall = []
var startTimeOneToOneVideoCall = []

exports.socketInitialize = function (httpServer) {
    console.log("INNN");
    var socketIO = require('socket.io').listen(httpServer);
    socketIO.on('connection', function (socket) {
        console.log("socket id ", socket.id);
        socket_id = socket.id; 
        console.log("Connected users ", usersConnected);
        /*
        * Authenticate user just after socket connection
        * params required session_id
        * */
        socket.on('authenticate', function (data) {
            console.log("authenticate ", data);
            //var data=JSON.parse(data);
            //console.log(data.user2_id);
            var sql = "SELECT * FROM app_login WHERE session_id = ? LIMIT 1";
            connection.query(sql, [data.session_id], function (error, user) {
                if (error) {
                    console.log("Unauthorized err ", error);
                    socketIO.to(socket_id).emit("unauthorized", "You are not authorized to connect");
                    socket.conn.close();
                } else if (user && user.length > 0) {
                    if (user[0].user_id > 0) {
                        if (usersConnected.hasOwnProperty("customer" + user[0].session_id)) {
                            usersConnected["customer" + user[0].session_id]['socket_id'] = socket.id;
                        } else {
                            usersConnected["customer" + user[0].session_id] = {
                                user_id: user[0].session_id,
                                socket_id: socket.id
                            };
                        }
                        var msg_id = user[0].user_id;
                        job.getMessage(msg_id, data.reciever_id, function (err, message_data) {
                            //console.log('message data',message_data);
                            if (socketIO.to(socket.id).emit("getMessage", message_data)) {
                                console.log('emit data');
                            } else {
                                console.log('data not emit');
                            }
                        })
                        socketIO.to(socket_id).emit("authorized", "You are authorized and connected");
                    } else {
                        console.log("Unauthorized");
                        socketIO.to(socket_id).emit("unauthorized", "You are not authorized to connect");
                        socket.conn.close();
                    }
                    console.log('after user connected', usersConnected);
                } else {
                    console.log("Unauthorized");
                    socketIO.to(socket_id).emit("unauthorized", "You are not authorized to connect");
                    socket.conn.close();
                }
            });
        });
        // receiving base64 file from client...
        socket.on('media_file', function (data) {
            job.sendImageToSql(data, function (err, getData) {
                if (err) {
                    console.log("error 111111", err)
                } else {
                    socketIO.emit('media_file', getData)
                    // socketIO.to(socket_id).emit('message_data',  getData)
                }
            })
        });
        socket.on('radio', function (data) {
            job.sendVoiceToSql(data, function (err, getData) {
                if (err) {
                    console.log("error 111111", err)
                } else {
                    // getData.obj.audio = data.door.URL.createObjectURL(new Blob([getData.obj.audio], { 'type' : 'audio/mp3' }))
                    socketIO.emit('voice', getData)
                    // socketIO.to(socket_id).emit('message_data',  getData)
                }
            })
        });
        socket.on('send_message', function (data) {
            var sql_data = `SELECT * FROM app_login WHERE session_id=?`;
            connection.query(sql_data, [data.session_id], function (error, appdetail) {
                //console.log(appdetail);
                if (appdetail && appdetail.length > 0) {
                    if (appdetail[0]['device_type'] == 2) {
                        var user_data = `SELECT * FROM app_login WHERE user_id=?`;
                        connection.query(user_data, [data.user_to_id], (error, res) => {
                            if (res && res.length > 0) {
                                if (res[0]['device_type'] == 2) {
                                    if (res[0]['session_id'] && usersConnected["customer" + res[0]['session_id']]) {
                                        job.sendMessage(data, function (err, getData) {
                                            if (socketIO.to(usersConnected["customer" + res[0]['session_id']]['socket_id']).emit("message_data", getData)) {
                                                socketIO.to(usersConnected["customer" + res[0]['session_id']]['socket_id']).emit("message_data", getData)
                                                console.log('emit data');
                                            } else {
                                                console.log('emit not data');
                                            }
                                        })
                                    } else {
                                        console.log('data not emit')
                                    }
                                } else {
                                    job.sendMessage(data, function (err, getData) {
                                        console.log('message val');
                                        if (socket.broadcast.emit("message_data", getData)) {
                                            socketIO.to(socket_id).emit('message_data', "d")
                                            // socketIO.to(usersConnected["customer"+res[0]['session_id']]['socket_id']).emit("message_data", getData)
                                            console.log('emit data');
                                        } else {
                                            console.log('emit not data');
                                        }
                                    });
                                }
                            }
                        })
                    } else {
                        //console.log('android');
                        job.sendMessage(data, function (err, getData) {
                            console.log('message val');
                            if (socket.broadcast.emit("message_data")) {
                                socketIO.emit("message_data", getData)
                                console.log('emit data');
                            } else {
                                console.log('emit not data');
                            }
                        });
                    }
                }
            })
        })
        socket.on('UserSendMessage', function (data) {
            job.getOrderData(data, function (err, result) {
                socketIO.to(socket_id).emit('order_data', result);
            });
        });
        socket.on('typing', function (data) {
            socketIO.emit('typing', data);
        });
        socket.on('disconnect', function (data) {
            console.log("disconnect socket", data);
            usersConnected = {};
            socket.conn.close();
        });
        socket.on('disconnect_user', function (data) {
            usersConnected = {};
            console.log("disconnect_user", data);
            socket.conn.close();
        });
        socket.on('error', function (err) {
            console.log("Socket error ", err);
        });

        /* --- video call sockets --- */

        socket.on('check_pick_video_call_status', function (resp) {
            const user_from_id = resp.user_from_id;
            const user_to_id = resp.user_to_id;
            const type = resp.type;
            const channel = resp.channel_name;
            const videoCallSendTimeCount = resp.pickVideoCallCount;
            console.log(channel, videoCallSendTimeCount + " counter...")
            if (!!channel) {
                if (videoCallSendTimeCount > 29) {
                    // query to check if the status ===0 or not...
                    job.checkIfCallReceived(channel, type, function (err, data) {
                        if (err) {
                            console.log("<<checkIfCallReceived >> error", err)
                            socketIO.emit("stop_pick_video_call_status", {
                                user_from_id,
                                user_to_id
                            });
                        } else {
                            const status = data.status;
                            console.log(status, "status.....")
                            if (status == 0) { // not accepted
                                job.changeVideoCallStatus(5, channel, type, function (err, getData) { // change status to 5
                                    if (err) {
                                        console.log("couldn't change the status..")
                                    } else {
                                        console.log("status changed to 5... call not picked..")
                                        socketIO.emit("call_not_picked_receiver_hide_page_video_call", {
                                            user_from_id: videoCallState.user_from_id,
                                            user_to_id: videoCallState.user_to_id
                                        });
                                    }
                                    socketIO.emit("stop_pick_video_call_status", {
                                        user_from_id,
                                        user_to_id
                                    });
                                })
                            }
                        else {
                            console.log("i am hereeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")
                            }
                        }
                    })
                } else {
                    job.checkIfCallReceived(channel, type, function (err, data) {
                        if (err) {
                            console.log("<<checkIfCallReceived >> error before 61 seconds...", err)
                            socketIO.emit("stop_pick_video_call_status", {
                                user_from_id,
                                user_to_id
                            });
                        } else {
                            const status = data.status;
                            if (status === 1) {
                                socketIO.emit("stop_pick_video_call_status", {
                                    user_from_id,
                                    user_to_id
                                });
                            }
                            if (status !== 0 && status !== 1) {
                                console.log("nooooooooooooooooooooooooooooooooooooooooooooooooooooooooot == 0");
                                socketIO.emit("call_malfunctioned_in_between_receiver_call_video_call", {
                                    user_from_id: videoCallState.user_from_id,
                                    user_to_id: videoCallState.user_to_id
                                });
                                socketIO.emit("stop_pick_video_call_status", {
                                    user_from_id,
                                    user_to_id
                                });
                            }
                        }
                    })
                }
            } else {
                socketIO.emit("stop_pick_video_call_status", {
                    user_from_id,
                    user_to_id
                });
            }
        })

        socket.on('authenticate_video_call', function (data) {
            console.log("authenticate ", data);
            // sender: {user_from_id: videoCallState.user_from_id, session_id: localStorage.getItem("session_id")},
            //     reciever_id: videoCallState.user_to_id,
            //     channel_name: videoCallState.channel_name
            // type: 0,1,2
            const sender_id = data.sender.user_from_id;
            const receiver_id = data.reciever_id;
            console.log(data.type, "909090099090909090909099009090")
            if (data.type === 0) {
                var sqlUserAuth = "SELECT * FROM `likes` where user_id = ? and liked_user_id = ? and accept = 1 or liked_user_id = ? and user_id = ? and accept = 1";
                var test = connection.query(sqlUserAuth, [sender_id, receiver_id, sender_id, receiver_id], function (error, user) {
                    if (error) {
                        console.log(error, "11111")
                        socketIO.emit("unauthorize_video_call", {user_from_id: sender_id, user_to_id: receiver_id});
                    } else {
                        console.log(test, "test query....")
                        if (user.length > 0) {
                            console.log("77777")
                            var sqlChannelAuth = "SELECT * FROM `video_call` where channel_name = ? and call_status = 0";
                            const query = connection.query(sqlChannelAuth, [data.channel_name], function (error, channel) {
                                if (error) {
                                    console.log("55555")
                                    // add query to change the status..... 3
                                    job.changeVideoCallStatus(3, data.channel_name, data.type, function (err, getData) {
                                        socketIO.emit("unauthorize_video_call", {
                                            user_from_id: sender_id,
                                            user_to_id: receiver_id
                                        });
                                    })
                                } else {
                                    console.log("66666")
                                    // expire check
                                    job.checkIfChannelExpired(data.channel_name, data.type, function (err, is_expired) {
                                        if (err) {
                                            console.log("qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq")
                                            videoCallState = null;
                                            socketIO.emit("unauthorize_video_call", {
                                                user_from_id: sender_id,
                                                user_to_id: receiver_id
                                            });
                                        } else {
                                            if (is_expired) {
                                                console.log("kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk")
                                                videoCallState = null;
                                                // add query to change the status..... 3
                                                job.changeVideoCallStatus(3, data.channel_name, data.type, function (err, getData) {
                                                    socketIO.emit("unauthorize_video_call", {
                                                        user_from_id: sender_id,
                                                        user_to_id: receiver_id
                                                    });
                                                })
                                            } else {
                                                console.log("not expired....");

                                                console.log(data.videoCallState, "checking state...")
                                                if (data.videoCallState !== null) {
                                                    console.log("sender found...")
                                                    videoCallState = data.videoCallState;
                                                    startTimeOneToOneVideoCall.push({ channel: data.channel_name, start_time: new Date().getTime() })
                                                    // emit event call send/receive....
                                                    // query to get the receiver details..
                                                    job.getReceiverDetails(sender_id, receiver_id, data.type, function (err, getData) {
                                                        let receiver_details = err ? null : (receiver_id == getData.details[0].id ? getData.details[0] : getData.details[1]);
                                                        let sender_details = err ? null : (sender_id == getData.details[0].id ? getData.details[0] : getData.details[1]);
                                                        console.log(getData, receiver_details, "receiver_details", sender_details, "sender_details")
                                                        if (!!receiver_details) {
                                                            console.log(receiver_details, "receiver_details...")
                                                            console.log(sender_details, "sender_details...")

                                                            // myInterval = setInterval( function() { intervalFunc(data.type); }, 1000 );
                                                            socketIO.emit("pick_video_call",
                                                                Object.assign(receiver_details, {
                                                                        user_from_id: sender_id,
                                                                        user_to_id: receiver_id,
                                                                        type: data.type,
                                                                        link: "/true/" + sender_id + "/" + receiver_id + "/" + videoCallState.channel_id + "/" + videoCallState.channel_name + "/video-chat",
                                                                        channel_name: videoCallState.channel_name,
                                                                        sender_details
                                                                    })
                                                                )
                                                        }
                                                    })
                                                } else {
                                                    console.log("receiver found...")
                                                }
                                                console.log(videoCallState, "videoCallState...")
                                                job.getUserDetails(sender_id, receiver_id, function (err, getData) {
                                                    if (err) {
                                                        console.log("error while authanticating user....")
                                                    }
                                                    else {
                                                        socketIO.emit("authorize_video_call", {
                                                            users_detail: getData,
                                                            user_from_id: sender_id,
                                                            user_to_id: receiver_id,
                                                            videoCallState
                                                        });
                                                    }
                                                })
                                            }
                                        }
                                    })
                                }
                            })
                        } else {
                            console.log("333333")
                            // unauthorized...
                            socketIO.emit("unauthorize_video_call", {user_from_id: sender_id, user_to_id: receiver_id});
                        }
                    }
                });
            } else if(data.type === 1) 
            {
                var sqlUserAuth = "SELECT * FROM `likes` where user_id = ? and liked_user_id = ? and accept = 1 or liked_user_id = ? and user_id = ? and accept = 1";
                var test = connection.query(sqlUserAuth, [sender_id, receiver_id, sender_id, receiver_id], function (error, user) {
                    if (error) {
                        console.log(error, "11111")
                        socketIO.emit("unauthorize_video_call", {user_from_id: sender_id, user_to_id: receiver_id});
                    } else {
                        console.log(test, "test query....")
                        if (user.length > 0) {
                            console.log("77777")
                            var sqlChannelAuth = "SELECT * FROM `audio_call` where channel_name = ? and call_status = 0";
                            const query = connection.query(sqlChannelAuth, [data.channel_name], function (error, channel) {
                                if (error) {
                                    console.log("55555")
                                    // add query to change the status..... 3
                                    job.changeVideoCallStatus(3, data.channel_name, data.type, function (err, getData) {
                                        socketIO.emit("unauthorize_video_call", {
                                            user_from_id: sender_id,
                                            user_to_id: receiver_id
                                        });
                                    })
                                } else {
                                    console.log("66666")
                                    // expire check
                                    job.checkIfChannelExpired(data.channel_name, data.type, function (err, is_expired) {
                                        if (err) {
                                            console.log("qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq")
                                            videoCallState = null;
                                            socketIO.emit("unauthorize_video_call", {
                                                user_from_id: sender_id,
                                                user_to_id: receiver_id
                                            });
                                        } else {
                                            if (is_expired) {
                                                console.log("kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk")
                                                videoCallState = null;
                                                // add query to change the status..... 3
                                                job.changeVideoCallStatus(3, data.channel_name, data.type, function (err, getData) {
                                                    socketIO.emit("unauthorize_video_call", {
                                                        user_from_id: sender_id,
                                                        user_to_id: receiver_id
                                                    });
                                                })
                                            } else {
                                                console.log("not expired....");

                                                console.log(data.videoCallState, "checking state...")
                                                if (data.videoCallState !== null) {
                                                    console.log("sender found...")
                                                    videoCallState = data.videoCallState;
                                                    // emit event call send/receive....
                                                    // query to get the receiver details..
                                                    job.getReceiverDetails(sender_id, receiver_id, data.type, function (err, getData) {
                                                        let receiver_details = err ? null : (receiver_id == getData.details[0].id ? getData.details[0] : getData.details[1]);
                                                        let sender_details = err ? null : (sender_id == getData.details[0].id ? getData.details[0] : getData.details[1]);
                                                        console.log(getData, receiver_details, "receiver_details", sender_details, "sender_details")
                                                        if (!!receiver_details) {
                                                            console.log(receiver_details, "receiver_details...")
                                                            console.log(sender_details, "sender_details...")

                                                            // myInterval = setInterval( function() { intervalFunc(data.type); }, 1000 );
                                                            socketIO.emit("pick_video_call",
                                                                Object.assign(receiver_details, {
                                                                        user_from_id: sender_id,
                                                                        user_to_id: receiver_id,
                                                                        type: data.type,
                                                                        link: "/true/" + sender_id + "/" + receiver_id + "/" + videoCallState.channel_id + "/" + videoCallState.channel_name + "/audio-chat",
                                                                        channel_name: videoCallState.channel_name,
                                                                        sender_details
                                                                    })
                                                                )
                                                        }
                                                    })
                                                } else {
                                                    console.log("receiver found...")
                                                }
                                                console.log(videoCallState, "videoCallState...")
                                                job.getUserDetails(sender_id, receiver_id, function (err, getData) {
                                                    if (err) {
                                                        console.log("error while authanticating user....")
                                                    }
                                                    else {
                                                        socketIO.emit("authorize_video_call", {
                                                            users_detail: getData,
                                                            user_from_id: sender_id,
                                                            user_to_id: receiver_id,
                                                            videoCallState
                                                        });
                                                    }
                                                })
                                            }
                                        }
                                    })
                                }
                            })
                        } else {
                            console.log("333333")
                            // unauthorized...
                            socketIO.emit("unauthorize_video_call", {user_from_id: sender_id, user_to_id: receiver_id});
                        }
                    }
                });
            }
            
            else {
                console.log("22222")
                // add query to change the status..... 3
                socketIO.emit("unauthorize_video_call", {user_from_id: sender_id, user_to_id: receiver_id});
            }
        });

        socket.on('unauthorize_video_call', function (data) {
            console.log("4444444")
            // sender: {user_from_id: videoCallState.user_from_id, session_id: localStorage.getItem("session_id")},
            //     reciever_id: videoCallState.user_to_id,
            //     channel_name: videoCallState.channel_name
            //     type: 0,
            //     status: 3

            // add query to change the status..... 3
            console.log(data.status, data.channel_name, "klklklklklklklklklklklklklklklklklklklklkl")
            job.changeVideoCallStatus(data.status, data.channel_name, data.type, function (err, getData) {
                socketIO.emit("unauthorize_video_call", {
                    user_from_id: data.sender.user_from_id,
                    user_to_id: data.reciever_id
                });
            })
        })

        socket.on('acknowledged_video_call', function (data) {
            // sender: {user_from_id: videoCallState.user_from_id, session_id: localStorage.getItem("session_id")},
            //     reciever_id: videoCallState.user_to_id,
            //     channel_name: videoCallState.channel_name
            //     type: 0,
            //     status: 1
            job.changeVideoCallStatus(data.status, data.channel_name, data.type, function (err, getData) {
                console.log("acknowledged_video_call...")
            })
            // add query to change the status..... 1
        })

        socket.on('timeCounter_video_call', function (data) {
            // sender: {user_from_id: videoCallState.user_from_id, session_id: localStorage.getItem("session_id")},
            //     reciever_id: videoCallState.user_to_id,
            //     channel_name: videoCallState.channel_name
            //     type: 0,
            //     status: 1
            console.log("sender_show_video_call called.... ")
            socketIO.emit("sender_show_video_call", {
                user_from_id: data.sender.user_from_id,
                user_to_id: data.reciever_id
            });

            // videoCallTimeInterval = window.setInterval(() => {
            //     // query to check the expire
            //     job.checkIfChannelExpired(data.channel_name, function(err, is_expired) {
            //         if (err) {
            //             console.log("sql state error.... in time check... in <<< timeCounter_video_call >>>")
            //             socketIO.to(socket_id).emit("timeCounter_video_call", { user_from_id: data.sender.user_from_id, user_to_id: data.reciever_id, is_expired: true });
            //         } else {
            //             if (is_expired) {
            //                 // query to change the status === 4
            //                 job.changeVideoCallStatus(3, data.channel_name,function(err, getData) {
            //                     clearInterval(videoCallTimeInterval)
            //                 })
            //             }
            //             socketIO.to(socket_id).emit("timeCounter_video_call", { user_from_id: data.sender.user_from_id, user_to_id: data.reciever_id, is_expired });
            //         }
            //     })
            // }, 5000)
        })


        socket.on("receiver_decline_video_call", function (data) {
            // sender: {user_from_id: receiverDetails.user_from_id},
            // reciever_id: receiverDetails.user_to_id,
            //     channel_name: receiverDetails.channel_name,
            //     type: 0,
            //     status: 2
            job.changeVideoCallStatus(data.status, data.channel_name, data.type, function (err, getData) {
                if (err) {
                    console.log("something went wrong..")
                } else {
                    socketIO.emit("receiver_decline_video_call", {
                        user_from_id: data.sender.user_from_id,
                        user_to_id: data.reciever_id,
                        showMsg: data.showMsg
                    });
                }
            })
        })

        socket.on("sender_decline_video_call", function (data) {
            // sender: {user_from_id: receiverDetails.user_from_id},
            // reciever_id: receiverDetails.user_to_id,
            //     channel_name: receiverDetails.channel_name,
            //     type: 0,
            //     status: 2
            job.changeVideoCallStatus(data.status, data.channel_name, data.type, function (err, getData) {
                if (err) {
                    console.log("something went wrong..")
                } else {
                    socketIO.emit("sender_decline_video_call", {
                        user_from_id: data.sender.user_from_id,
                        user_to_id: data.reciever_id,
                        showMsg: data.showMsg
                    });
                }
            })
        })

        /*  handling live video call events.... */

        socket.on('authenticate_friend_list_live', function (data) {
            job.getVideoLiveList(function (err, list) {
                //console.log('message data',message_data);
                if (err) {
                    socketIO.emit("live_friends", list);
                } else {
                    socketIO.emit("live_friends", list);
                }
            })
        });

        socket.on('start_live_video_call', function (data) {
            console.log(data, "data....")
            if (!!data) {
                // query to make it live...
                job.makeMeLive(data, function (err, response) {
                    if (err) {
                        console.log("sorry couldn't make host live now...")
                    } else {
                        video_live_hosts.push({channel_name: data.channel_name, host_id: data.host_id})
                        console.log("host is live now...")
                        socketIO.emit("start_your_live_video_now", data);
                    }
                })
            }
        });

        socket.on('authenticate_live_video_call', function (data) {
            if (!data.is_host) {
                // query to check if host and audience are friends..
                job.checkIfHostAndAudienceAreFrd(data.channel_name, data.user_id, function (err, getData) {
                    if (err) {
                        console.log("something went wrong.. while checking if host and user are frds...")

                        socketIO.emit("unauthorize_live_video_call", data);
                    } else {
                        if (getData.length > 0) {
                            socketIO.emit("authorize_live_video_call", data);
                        } else {
                            socketIO.emit("unauthorize_live_video_call", data);
                        }
                    }
                })
            } else {
                // host
                job.checkIfHostIsLive(data.channel_name, data.host_id, function (err, getData) {
                    if (err) {
                        console.log("something went wrong.. while checking if host is live")

                        socketIO.emit("unauthorize_live_video_call", data);
                    } else {
                        if (getData.length > 0) {
                            startTimeLiveVideoCall.push({ channel: data.channel_name, start_time: new Date().getTime() })
                            socketIO.emit("authorize_live_video_call", data);
                        } else {
                            socketIO.emit("unauthorize_live_video_call", data);
                        }
                    }
                })
            }
        });
        // socket.on('authenticate_live_video_call', function (data) {
        //
        // })

        socket.on('addAudienceToLiveVideo', function (data) {
            console.log(data, "data....")
            let host_id = null;
            if (!!data) {
                // query to make it live...
                job.makeMeAudience(data, function (err, response) {
                    if (err) {
                        console.log("sorry couldn't make audience  now...")
                    } else {
                        video_live_hosts.forEach((value, index) => {
                            if (value.channel_name === data.channel_name) {
                                host_id = value.host_id;
                            }
                        })
                        console.log("audience is active now...")
                        socketIO.emit("sendAudienceToLiveVideo", Object.assign(data, {host_id}));
                    }
                })
            }
        })

        socket.on('end_live_video_call_audience', function (data) {
            console.log(data, "data....");
            job.declineAudienceLiveVideoCall(data.user_id, data.channel_name, function (err, response) {
                if (err) {
                    console.log("sorry audience cannot be declined...")
                } else {
                    socketIO.emit("end_live_video_call_audience", data);
                }
            })
        })

        socket.on('end_live_video_call_host', function (data) {
            job.declineHostLiveVideoCall(data.channel_name, function (err, response) {
                if (err) {
                    console.log("sorry host cannot be declined...")
                } else {
                    console.log(response, "response..... baby...")
                    socketIO.emit("end_live_video_call_host", Object.assign(data));
                }
            })
        })

        /* ---- gifts -----*/
        socket.on('gift_send',function(data){
            job.sendGiftToSql(data,function(err,getData){
                if(err)
                {
                    console.log("error gift222222", err)
                }
                else
                {
                    socketIO.emit('gift_send',getData)
                }
            });
        })

    /* live video message sockets... */

    socket.on('authenticate_live_video_message', function (data) {
        var sql = "SELECT * FROM app_login WHERE user_id = ? LIMIT 1";
        connection.query(sql, [data.user_id, data.sender_id], function (error, user) {  //user_id=receiver(audience) , sender_id=host (sender)
            if (error) {
                socketIO.to(socket_id).emit("get_messages_live_video", {error: true, messages: [], error_message: "Unauthorized user access.", channel_name: data.channel_name, user_id: data.user_id, sender_id: data.sender_id});
                socket.conn.close();
            } else if (user && user.length > 0) {
                if (user[0].user_id > 0) {
                    job.getMessageLiveVideo(data.user_id, data.channel_name, data.sender_id, function (err, message_data) {
                        if (!err) {
                            socketIO.to(socket.id).emit("get_messages_live_video", {error: false, messages: message_data.message_list, channel_name: data.channel_name, user_id: data.user_id, sender_id: data.sender_id})  
                        }
                        else {
                            socketIO.to(socket.id).emit("get_messages_live_video", {error: true, messages: [], error_message: "Error fetching the messages", channel_name: data.channel_name, user_id: data.user_id, sender_id: data.sender_id})  
                        }
                    })
                } else {
                    socketIO.to(socket_id).emit("get_messages_live_video", {error: true, messages: [], error_message: "Unauthorized user access." ,channel_name: data.channel_name, user_id: data.user_id, sender_id: data.sender_id});
                    socket.conn.close();
                }
            } else {
                console.log("Unauthorized");
                socketIO.to(socket_id).emit("get_messages_live_video", {error: true, messages: [], error_message: "Unauthorized user access.", channel_name: data.channel_name, user_id: data.user_id, sender_id: data.sender_id});
                socket.conn.close();
            }
        });
    });

    socket.on('typing_live_video_message', function (data) {
        socketIO.emit('typing_live_video_message', data);
    });

    // Insert live video messages socktes
    socket.on('send_live_video_item', function (data) {
        job.insertMessageLiveVideo(data, data.channel_name, function (err, message_data) {
            if (err) {
                console.log("error found ..., send_live_video_item", err);
                // socketIO.emit("send_live_video_item", {message: null, error_message: "Something went wrong...", channel_name: data.channel_name})  
            }
            else {
                socketIO.emit("send_live_video_item", {message: message_data.message, channel_name: data.channel_name, user_id: data.user_id, sender_id: data.sender_id})  
            }
        })
    });

    // Manage live video coins, time, views socktes
    socket.on('live_video_manage_coins_time_views', function (data) {
        job.manageCoinsTimeViewsLiveVideo(data, function (err, message_data) {
            if (err) {
                socketIO.emit("end_live_video_call_host_warning", data)   
                console.log("error found ..., live_video_manage_coins_time_views", err);
            }
            else {
                console.log(message_data, "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk")
                if (message_data.error == false && message_data.msg == "") {
                    console.log(message_data+" successssssssssssss");
                    socketIO.emit("live_video_manage_coins_time_views", message_data);  
                }
                else {
                    console.log(data+" erroorrrrrrrrrrrrrrr");
                    socketIO.emit("end_live_video_call_audience_warning", message_data)
                }
            
            }
        })
    });

    // Live video manage time socktes
    socket.on('live_video_manage_time', function (data) {
        let start_time = null;
        startTimeLiveVideoCall.forEach((item, index) => {
            if (data.channel_name == item.channel) {
                start_time = item.start_time
            }
        })
        if (start_time != null) {
            var start = moment(start_time);
            var end = moment(new Date().getTime());
            var time = start.from(end);
            data.time = time;
            socketIO.emit("live_video_manage_time", data);
        }   
        else {
            console.log(start_time, "wrong start time.....")
        }
    });


    socket.on('live_video_manage_views', function (data) {
        job.manageViewsLiveVideo(data, function (err, views) {
            if (err) {
                console.log("error found ..., live_video_manage_views", err);
            }
            else {
                data.views = views;
                 socketIO.emit("live_video_manage_views", data)
            }
        })
    });

/* one to one video call sockets */

// one-to-one video manage time socktes
socket.on('one_to_one_video_manage_time', function (data) {
    let start_time = null;
    startTimeOneToOneVideoCall.forEach((item, index) => {
        if (data.channel_name == item.channel) {
            start_time = item.start_time
        }
    })
    if (start_time != null) {
        var start = moment(start_time);
        var end = moment(new Date().getTime());
        var time = start.from(end);
        data.time = time;
        socketIO.emit("one_to_one_video_manage_time", data);
    }   
    else {
        console.log(start_time, "wrong start time.....")
    }
});  // done


// Manage one-to-one video coins, time, views socktes
socket.on('one_to_one_video_manage_coins_time_views', function (data) {
    job.manageCoinsTimeViewsOneToOneVideo(data, function (err, message_data) {
        if (err) {
            data.msg = "We are facing some technical issues. Please call after some time."
            socketIO.emit("end_one_to_one_video_call_warning", data)   
            console.log("error found ..., one_to_one_video_manage_coins_time_views", err);
        }
        else {
            console.log(message_data, "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk")
            if (message_data.error == false && message_data.msg == "") {
                console.log(message_data+" successssssssssssss");
                socketIO.emit("one_to_one_video_manage_coins_time_views", message_data);  
            }
            else {
                console.log(data+" erroorrrrrrrrrrrrrrr");
                socketIO.emit("end_one_to_one_video_call_no_coin_warning", message_data)
            }
        
        }
    })
}); // done

socket.on('typing_one_to_one_video_message', function (data) {
    socketIO.emit('typing_one_to_one_video_message', data);
});  // done

   socket.on('authenticate_one_to_one_video_message', function (data) {
    var sql = "SELECT * FROM app_login WHERE user_id = ? LIMIT 1";
    connection.query(sql, [data.user_id, data.sender_id], function (error, user) {  //user_id=receiver(audience) , sender_id=host (sender)
        if (error) {
            socketIO.to(socket_id).emit("get_messages_one_to_one_video", {error: true, messages: [], error_message: "Unauthorized user access.", channel_name: data.channel_name, user_id: data.user_id, sender_id: data.sender_id});
            socket.conn.close();
        } else if (user && user.length > 0) {
            if (user[0].user_id > 0) {
                job.getMessageOneToOneVideo(data.user_id, data.channel_name, data.sender_id, function (err, message_data) {
                    if (!err) {
                        socketIO.to(socket.id).emit("get_messages_one_to_one_video", {error: false, messages: message_data.message_list, channel_name: data.channel_name, user_id: data.user_id, sender_id: data.sender_id})  
                    }
                    else {
                        socketIO.to(socket.id).emit("get_messages_one_to_one_video", {error: true, messages: [], error_message: "Error fetching the messages", channel_name: data.channel_name, user_id: data.user_id, sender_id: data.sender_id})  
                    }
                })
            } else {
                socketIO.to(socket_id).emit("get_messages_one_to_one_video", {error: true, messages: [], error_message: "Unauthorized user access." ,channel_name: data.channel_name, user_id: data.user_id, sender_id: data.sender_id});
                socket.conn.close();
            }
        } else {
            console.log("Unauthorized");
            socketIO.to(socket_id).emit("get_messages_one_to_one_video", {error: true, messages: [], error_message: "Unauthorized user access.", channel_name: data.channel_name, user_id: data.user_id, sender_id: data.sender_id});
            socket.conn.close();
        }
    });
}); 

// Insert one-to-one video messages socktes
socket.on('send_one_to_one_video_item', function (data) {
    job.insertMessageOneToOneVideo(data, data.channel_name, function (err, message_data) {
        if (err) {
            console.log("error found ..., send_live_video_item", err);
            // socketIO.emit("send_live_video_item", {message: null, error_message: "Something went wrong...", channel_name: data.channel_name})  
        }
        else {
            socketIO.emit("send_one_to_one_video_item", {message: message_data.message, channel_name: data.channel_name, user_id: data.user_id, sender_id: data.sender_id})  
        }
    })
});
})
}




